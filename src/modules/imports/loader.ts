import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { importJobs, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { buildContextForUser, type AuthContext } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { DomainError } from "@/lib/errors";
import { getMaintenanceState } from "@/lib/maintenance";
import { mfaStateFor, verifySecondFactor } from "@/modules/identity";
import { loaderGuard, type GuardEnv } from "./guard";
import { getImportJob, exportImportRows } from "./queries";
import { approveImport, postImport, startValidation, submitImport, uploadImport } from "./service";

/**
 * Go-live command-line loader (US-2-25, docs/data-migration-plan.md §9.4). Same engine, tables, rules,
 * error file and audit events as the wizard; only the front end differs.
 *
 *   pnpm migrate:load --kind <kind> --file <path> --site <code> [--mapping <code>] --as <email> [--reason <text>]
 *       (dry run, the default: upload + validate; a clean result is submitted for approval)
 *   pnpm migrate:approve <IMP-number> --as <email>      (second person)
 *   pnpm migrate:load --post --job <IMP-number> --as <email>
 *
 * `--as` needs the person's password typed interactively (and the authenticator code when enrolled).
 * The guard of ./guard.ts refuses production without MIGRATION_WINDOW_OPEN=true and refuses --post unless
 * the read-only maintenance mode is on. Exit codes: 0 done, 1 refused or failed, 3 validated with rejects.
 */
export type LoaderArgs = {
  command: "load" | "approve";
  kind?: string;
  file?: string;
  site?: string;
  mapping?: string;
  as?: string;
  post?: boolean;
  job?: string;
  reason?: string;
};

export type LoaderDeps = {
  env: GuardEnv;
  readFile: (path: string) => Promise<Uint8Array>;
  writeFile: (path: string, body: Uint8Array) => Promise<void>;
  prompt: (question: string, opts: { secret: boolean }) => Promise<string>;
  log: (line: string) => void;
};

export function parseLoaderArgs(argv: string[]): LoaderArgs {
  const out: LoaderArgs = { command: "load" };
  const rest = [...argv];
  if (rest[0] === "approve") {
    out.command = "approve";
    rest.shift();
    if (rest[0] && !rest[0].startsWith("--")) out.job = rest.shift();
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const val = () => {
      const v = rest[++i];
      if (v === undefined || v.startsWith("--")) throw new DomainError("validation", `${a} needs a value.`);
      return v;
    };
    if (a === "--kind") out.kind = val();
    else if (a === "--file") out.file = val();
    else if (a === "--site") out.site = val();
    else if (a === "--mapping") out.mapping = val();
    else if (a === "--as") out.as = val();
    else if (a === "--job") out.job = val();
    else if (a === "--reason") out.reason = val();
    else if (a === "--post") out.post = true;
    else if (a === "--dry-run") out.post = false;
    else throw new DomainError("validation", `Unknown option ${a}.`);
  }
  return out;
}

/** Interactive re-authentication of the named user: password, then the authenticator code when enrolled. */
async function authenticate(args: LoaderArgs, deps: LoaderDeps, siteId: string | null): Promise<AuthContext> {
  if (!args.as) throw new DomainError("validation", "--as <email> is required: the loader runs as a named person with the posting permissions.");
  const [u] = await db.select().from(users).where(eq(users.email, args.as.trim().toLowerCase())).limit(1);
  const password = await deps.prompt(`Password for ${args.as}: `, { secret: true });
  const ok = !!u && u.status === "active" && !!u.passwordHash && (await verifyPassword(u.passwordHash, password));
  if (!ok || !u) throw new DomainError("reauth_required", "The email or password is not correct.");
  const mfa = await mfaStateFor(db, u.organizationId, u.id);
  if (mfa.enrolled) {
    const code = await deps.prompt("Code from your authenticator app: ", { secret: false });
    await db.transaction((tx) => verifySecondFactor(tx, { id: u.id, organizationId: u.organizationId, email: u.email }, code, new Date()));
  }
  const ctx = await buildContextForUser(u.id, siteId, { correlationId: uuidv7() });
  if (!ctx) throw new DomainError("forbidden", `${args.as} has no active site assignment.`);
  await audit(db, ctx, { action: "identity.reauth.succeeded", entityType: "user", entityId: ctx.userId, siteId: null, after: { purpose: `migration loader ${args.command}${args.post ? " --post" : ""}` } });
  return ctx;
}

async function siteByCode(code: string) {
  const [s] = await db.select({ id: sites.id, organizationId: sites.organizationId }).from(sites).where(eq(sites.code, code.trim().toUpperCase())).limit(1);
  if (!s) throw new DomainError("validation", `Site ${code} not found.`);
  return s;
}

async function jobByNumber(number: string) {
  const [j] = await db.select().from(importJobs).where(eq(importJobs.importNumber, number.trim().toUpperCase())).limit(1);
  if (!j) throw new DomainError("not_found", `Import ${number} not found.`);
  return j;
}

function summary(d: Awaited<ReturnType<typeof getImportJob>>) {
  const j = d.job;
  return `${j.importNumber} ${j.importKind} at ${d.siteCode}: ${j.status}. Rows ${j.rowsTotal}: accepted ${j.rowsAccepted}, hold ${j.rowsHold}, duplicate ${j.rowsDuplicate}, possible duplicate ${j.rowsPossibleDuplicate}, rejected ${j.rowsRejected}, created ${j.rowsCreated}, failed ${j.rowsFailed}.`;
}

export async function runLoader(args: LoaderArgs, deps: LoaderDeps): Promise<number> {
  const mode = args.command === "approve" ? "approve" : args.post ? "post" : "dry_run";
  let organizationId: string | null = null;
  let siteId: string | null = null;
  if (args.job) {
    const j = await jobByNumber(args.job);
    organizationId = j.organizationId;
    siteId = j.siteId;
  } else if (args.site) {
    const s = await siteByCode(args.site);
    organizationId = s.organizationId;
    siteId = s.id;
  }
  if (!organizationId) throw new DomainError("validation", mode === "dry_run" ? "--site <code> is required." : "--job <IMP number> is required.");
  const state = await getMaintenanceState(db, organizationId);
  const g = loaderGuard(deps.env, { mode, readOnlyEnabled: state.enabled });
  if (!g.ok) {
    deps.log(g.reason);
    return 1;
  }
  const ctx = await authenticate(args, deps, siteId);

  if (mode === "approve") {
    const j = await jobByNumber(args.job!);
    await approveImport(ctx, j.id, args.reason ?? "Approved through the migration loader");
    deps.log(summary(await getImportJob(ctx, j.id)));
    return 0;
  }
  if (mode === "post") {
    const j = await jobByNumber(args.job!);
    await postImport(ctx, j.id, { inline: true, env: deps.env });
    const d = await getImportJob(ctx, j.id);
    deps.log(summary(d));
    return d.job.status === "posted" && d.job.rowsFailed === 0 ? 0 : 1;
  }
  if (!args.kind || !args.file) throw new DomainError("validation", "--kind and --file are required for a load.");
  const bytes = await deps.readFile(args.file);
  const fileName = args.file.split(/[\\/]/).pop()!;
  const up = await uploadImport(ctx, { kind: args.kind, siteId: siteId!, fileName, bytes, idempotencyKey: `loader:${uuidv7()}`, reuploadReason: args.reason ?? null, mappingCode: args.mapping ?? null, source: "loader" });
  deps.log(`Uploaded ${fileName} as ${up.importNumber}.`);
  await startValidation(ctx, up.jobId, { inline: true });
  let d = await getImportJob(ctx, up.jobId);
  const errors = await exportImportRows(ctx, up.jobId, "results");
  const errorPath = `${args.file}.${up.importNumber}.results.csv`;
  await deps.writeFile(errorPath, errors.body);
  deps.log(`Results file: ${errorPath}`);
  if (d.job.status === "validated" && d.job.rowsAccepted + d.job.rowsHold > 0) {
    await submitImport(ctx, up.jobId);
    d = await getImportJob(ctx, up.jobId);
    deps.log(`Submitted for approval. A second person runs: pnpm migrate:approve ${up.importNumber} --as <email>; then: pnpm migrate:load --post --job ${up.importNumber} --as <email>`);
  } else if (d.job.status === "under_review") {
    deps.log("Possible duplicates need a decision in the import wizard (Admin → Imports) before the job can be submitted.");
  }
  deps.log(summary(d));
  return d.job.rowsRejected > 0 ? 3 : 0;
}

