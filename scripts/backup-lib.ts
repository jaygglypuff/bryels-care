/**
 * Shared pieces of the logical backup (scripts/backup-dump.ts) and the restore drill
 * (scripts/restore-drill.ts): where dumps are stored, S3 signing for PUT/GET/DELETE, the exact row
 * counts recorded at dump time, the ledger reconciliation query and process helpers.
 * docs/deployment-railway.md §9–§10, docs/operations-runbook.md §13.
 *
 * Storage targets (no SDK; AWS Signature V4 like src/lib/storage):
 *   primary  BACKUP_S3_* (falls back to the app bucket S3_*), or BACKUP_LOCAL_DIR for development drills
 *   offsite  BACKUP_OFFSITE_S3_* (another provider), or BACKUP_OFFSITE_LOCAL_DIR for development drills
 */
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { presignGetUrl, signPutHeaders, uriEncode, objectLocation, type S3Config } from "../src/lib/storage/sigv4";

export type Target = { kind: "s3"; name: string; cfg: S3Config } | { kind: "local"; name: string; dir: string };

function s3From(env: NodeJS.ProcessEnv, prefix: string): S3Config | null {
  const g = (k: string) => env[`${prefix}${k}`];
  const need = ["ENDPOINT", "BUCKET", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"];
  if (need.some((k) => !g(k))) return null;
  return { endpoint: g("ENDPOINT")!, bucket: g("BUCKET")!, region: g("REGION")!, accessKeyId: g("ACCESS_KEY_ID")!, secretAccessKey: g("SECRET_ACCESS_KEY")!, forcePathStyle: g("FORCE_PATH_STYLE") === "true" };
}

/** The primary target (Railway Bucket) and the offsite target (other provider); null when not configured. */
export function targets(env: NodeJS.ProcessEnv = process.env): { primary: Target | null; offsite: Target | null } {
  const primary: Target | null = env.BACKUP_LOCAL_DIR
    ? { kind: "local", name: "local", dir: path.resolve(env.BACKUP_LOCAL_DIR) }
    : (() => {
        const cfg = s3From(env, "BACKUP_S3_") ?? s3From(env, "S3_");
        return cfg ? { kind: "s3" as const, name: "bucket", cfg } : null;
      })();
  const offsite: Target | null = env.BACKUP_OFFSITE_LOCAL_DIR
    ? { kind: "local", name: "offsite-local", dir: path.resolve(env.BACKUP_OFFSITE_LOCAL_DIR) }
    : (() => {
        const cfg = s3From(env, "BACKUP_OFFSITE_S3_");
        return cfg ? { kind: "s3" as const, name: "offsite", cfg } : null;
      })();
  return { primary, offsite };
}

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve()).on("error", reject);
  });
  return h.digest("hex");
}

/** Presigned URL for any method (DELETE for pruning); same algorithm as presignGetUrl. */
function presign(cfg: S3Config, method: "DELETE", key: string, expiresIn = 60, now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = iso.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const loc = objectLocation(cfg, key);
  const params: Record<string, string> = { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`, "X-Amz-Date": iso, "X-Amz-Expires": String(expiresIn), "X-Amz-SignedHeaders": "host" };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&");
  const canonical = [method, loc.path, query, `host:${loc.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", iso, scope, sha256Hex(canonical)].join("\n");
  const hm = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();
  const key4 = hm(hm(hm(hm("AWS4" + cfg.secretAccessKey, dateStamp), cfg.region), "s3"), "aws4_request");
  return `${loc.origin}${loc.path}?${query}&X-Amz-Signature=${createHmac("sha256", key4).update(toSign).digest("hex")}`;
}

/** Uploads a file (single PUT: the dump is read into memory; fine for databases of a few GB at most, A-W4F-06). */
export async function putObject(t: Target, key: string, file: string, meta: { sha256: string }) {
  if (t.kind === "local") {
    const dest = path.join(t.dir, ...key.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(file, dest);
    await writeFile(`${dest}.sha256`, `${meta.sha256}\n`);
    return;
  }
  const body = new Uint8Array(await readFile(file));
  const { url, headers } = signPutHeaders(t.cfg, key, body, "application/octet-stream");
  const res = await fetch(url, { method: "PUT", headers, body: Buffer.from(body) });
  if (!res.ok) throw new Error(`${t.name} upload failed with HTTP ${res.status}`);
}

export async function getObject(t: Target, key: string, dest: string) {
  if (t.kind === "local") {
    await copyFile(path.join(t.dir, ...key.split("/")), dest);
    return;
  }
  const res = await fetch(presignGetUrl(t.cfg, key, { expiresIn: 300 }));
  if (!res.ok) throw new Error(`${t.name} download failed with HTTP ${res.status}`);
  await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
}

export async function deleteObject(t: Target, key: string) {
  if (t.kind === "local") {
    await rm(path.join(t.dir, ...key.split("/")), { force: true });
    await rm(path.join(t.dir, ...key.split("/")) + ".sha256", { force: true });
    return;
  }
  const res = await fetch(presign(t.cfg, "DELETE", key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`${t.name} delete failed with HTTP ${res.status}`);
}

export async function fileSize(file: string) {
  return (await stat(file)).size;
}

/** Runs a command; rejects with its stderr (never the connection string) on a non-zero exit. */
export function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; redact?: string[] } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...(opts.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => reject(new Error(`${cmd} could not start: ${e.message}. Is it installed (docs/deployment-railway.md §2.1)?`)));
    p.on("close", (code) => {
      let msg = stderr.trim().slice(-1500);
      for (const r of opts.redact ?? []) if (r) msg = msg.split(r).join("[redacted]");
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}: ${msg}`));
    });
  });
}

/**
 * Tables counted exactly at dump time (inside the dump's snapshot) and compared at every drill.
 * docs/data-model.md §3.10 names the first four; the rest cover each module's main records.
 */
export const COUNTED_TABLES = [
  "stock_movements",
  "audit_events",
  "batches",
  "users",
  "inventory_lots",
  "inventory_balances",
  "sales_orders",
  "shipments",
  "dispense_records",
  "test_results",
  "dispositions",
  "approval_decisions",
  "goods_receipts",
  "complaints",
] as const;

/** The ledger-versus-projection check of docs/data-model.md §5.6 (same query as src/modules/inventory/reconciliation.ts). */
export const RECONCILIATION_SQL = `
  with ledger as (
    select lot_id, location_id, sum(delta) as qty from (
      select lot_id, to_location_id as location_id, qty_base as delta from stock_movements where to_location_id is not null
      union all
      select lot_id, from_location_id, -qty_base from stock_movements where from_location_id is not null
    ) x group by 1, 2
  ), projection as (
    select lot_id, location_id, sum(qty_base) as qty from inventory_balances group by 1, 2
  )
  select count(*)::int as n from ledger l full outer join projection p on p.lot_id = l.lot_id and p.location_id = l.location_id
   where coalesce(l.qty, 0) <> coalesce(p.qty, 0)`;

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);

/** JSON log line (docs/deployment-railway.md §7); never includes a connection string or a key. */
export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, service: "backup", time: new Date().toISOString(), ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Date-based key: <prefix>/<yyyy>/<mm>/db-<yyyymmddThhmmssZ>.dump[.age] */
export function dumpKey(prefix: string, at: Date, encrypted: boolean) {
  const iso = at.toISOString();
  const stamp = iso.replace(/[:-]|\.\d{3}/g, "");
  return `${prefix.replace(/\/+$/, "")}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/db-${stamp}.dump${encrypted ? ".age" : ""}`;
}

/** Retention for logical dumps (A-SEC-31): the newest 35 days, plus the newest dump of each of the last 12 months. */
export function pruneCandidates<T extends { id: string; finishedAt: Date; hold: boolean }>(runs: T[], now: Date, daily = 35, monthly = 12): T[] {
  const dayCut = now.getTime() - daily * 86_400_000;
  const keepMonthly = new Set<string>();
  const byMonth = new Map<string, T>();
  for (const r of [...runs].sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())) {
    const m = r.finishedAt.toISOString().slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, r);
  }
  const months = [...byMonth.keys()].sort().reverse().slice(0, monthly);
  for (const m of months) keepMonthly.add(byMonth.get(m)!.id);
  return runs.filter((r) => !r.hold && r.finishedAt.getTime() < dayCut && !keepMonthly.has(r.id));
}
