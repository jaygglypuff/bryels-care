import "server-only";
import { execFile } from "node:child_process";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, organizations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { NON_DEMO_USER_PREDICATE, isDemoMode, realAccountsRefusal } from "@/lib/demo";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/log";
import { assertStepUp } from "@/modules/identity";

/**
 * Owner-only "Reset demo data" (ADR-044, docs/railway-for-dummies.md "Reset the demo"). Demo mode only;
 * owner_director only; step-up re-authentication; typed confirmation; refused while any non-demo
 * account exists. The wipe and reload run in a child process (`src/db/demo.ts reset`, the same code
 * as `pnpm db:demo reset`) under an advisory lock; the result is reported honestly (duration, or the
 * failure message). The audit trail is part of what is wiped, so the reset is recorded twice: a
 * structured log line before (kept by Railway's logs) and `platform.demo.reset` in the new data.
 */

export const DEMO_RESET_CONFIRM_WORD = "RESET";

export type DemoResetStatus = { available: boolean; reason: string | null; realAccounts: number };

async function realAccountCount(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from users where ${NON_DEMO_USER_PREDICATE}`));
  return Number(r[0]?.n ?? 0);
}

const isOwner = (ctx: AuthContext) => ctx.actor.kind === "user" && ctx.roleCodes.includes("owner_director");

/** What the reset screen may offer to this person. */
export async function demoResetStatus(ctx: AuthContext): Promise<DemoResetStatus> {
  if (!isDemoMode()) return { available: false, reason: "This is not a demo environment.", realAccounts: 0 };
  if (!isOwner(ctx)) return { available: false, reason: "Only the Owner/Director can reset the demo data.", realAccounts: 0 };
  const real = await realAccountCount();
  if (real > 0) return { available: false, reason: realAccountsRefusal(real), realAccounts: real };
  return { available: true, reason: null, realAccounts: 0 };
}

export type DemoResetRunner = () => Promise<{ code: number; output: string }>;

/** Runs `node --import tsx src/db/demo.ts reset` (up to 10 minutes) and returns its exit code and output. */
const childRunner: DemoResetRunner = () =>
  new Promise((resolve) => {
    execFile(process.execPath, ["--import", "tsx", "src/db/demo.ts", "reset"], { cwd: process.cwd(), env: process.env, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, output: `${stdout}\n${stderr}` });
    });
  });

const lastLines = (out: string, n = 3) =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .map((l) => l.replace(/^\[demo\]\s*/, ""))
    .join(" ");

export async function resetDemoData(ctx: AuthContext, input: { confirm: string }, deps: { runner?: DemoResetRunner; now?: Date } = {}): Promise<{ durationSeconds: number }> {
  if (!isDemoMode()) throw new DomainError("forbidden", "Resetting is only possible in the demo environment.");
  if (!isOwner(ctx)) {
    await db.insert(auditEvents).values({ organizationId: ctx.organizationId, actorId: ctx.actor.kind === "user" ? ctx.userId : null, actorLabel: ctx.actorLabel, action: "identity.authorization.denied", entityType: "organization", entityId: ctx.organizationId, reason: "Only the Owner/Director can reset the demo data.", after: { permission: "platform.demo.reset" }, correlationId: ctx.correlationId });
    throw new DomainError("forbidden", "Only the Owner/Director can reset the demo data.");
  }
  await assertStepUp(ctx, "reset the demo data", deps.now);
  if ((input.confirm ?? "").trim().toUpperCase() !== DEMO_RESET_CONFIRM_WORD) {
    throw new DomainError("validation", `Type ${DEMO_RESET_CONFIRM_WORD} to confirm.`, { field: "confirm" });
  }
  const real = await realAccountCount();
  if (real > 0) throw new DomainError("conflict", realAccountsRefusal(real));

  logger.warn("demo reset requested", { module: "platform", command: "platform.demo.reset", userId: ctx.userId, outcome: "started" });
  const started = Date.now();
  const r = await (deps.runner ?? childRunner)();
  const durationSeconds = Math.round((Date.now() - started) / 1000);
  if (r.code === 2) throw new DomainError("conflict", lastLines(r.output, 2) || "The reset was refused.");
  if (r.code !== 0) {
    logger.error("demo reset failed", { module: "platform", command: "platform.demo.reset", outcome: "failed", durationMs: Date.now() - started, detail: lastLines(r.output, 8) });
    throw new DomainError("setup_required", `The reset did not finish: ${lastLines(r.output) || "unknown error"}. The database was left empty; the next restart of the web service loads the demo data again.`);
  }
  // Record the reset in the fresh data (the previous audit trail was part of the wipe).
  const [org] = await db.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
  if (org) {
    await db.insert(auditEvents).values({ organizationId: org.id, actorLabel: "system:demo.reset", action: "platform.demo.reset", entityType: "organization", entityId: org.id, reason: "Demo data reset by the Owner/Director", after: { requestedBy: ctx.email, durationSeconds } });
  }
  logger.warn("demo reset finished", { module: "platform", command: "platform.demo.reset", userId: ctx.userId, outcome: "succeeded", durationMs: Date.now() - started });
  return { durationSeconds };
}
