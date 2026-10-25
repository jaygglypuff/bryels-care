import { createHmac } from "node:crypto";
import { type Env, demoModeState } from "./demo";

/**
 * Railway-friendly runtime defaults and the start-up self-check (ADR-055, docs/railway-for-dummies.md,
 * docs/deployment-railway.md §2.4). Pure functions over an env object; no database, no Next.js.
 *
 * `applyRuntimeDefaults` fills in settings that can be derived safely, in every process that needs
 * them (Next.js server via src/instrumentation.ts, worker, admin scripts):
 * - APP_ORIGIN from Railway's RAILWAY_PUBLIC_DOMAIN (https://<domain>), and a pasted origin without
 *   `https://` or with a trailing slash is normalised;
 * - TRUSTED_PROXY_HEADER = x-real-ip on Railway (Railway's documented client-IP header);
 * - FILE_STORAGE = s3 when every S3_* variable is present; in demo mode, local files on an attached
 *   Railway volume (RAILWAY_VOLUME_MOUNT_PATH) when there is no bucket;
 * - in demo mode only: FILE_URL_SECRET and DATA_ENCRYPTION_KEY derived from DATABASE_URL when unset
 *   (stable across restarts; clearly logged as not for production).
 * Values that are already set are never changed (except the origin clean-up).
 *
 * `selfCheck` turns the result into plain-language lines ("missing X — do Y") and says whether the
 * process can start at all. Only a missing or unresolved DATABASE_URL is fatal.
 */

export type Note = { level: "error" | "warn" | "info"; setting: string; message: string };
export type Service = "web" | "worker" | "script";

const onRailway = (env: Env) => !!(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || env.RAILWAY_PUBLIC_DOMAIN || env.RAILWAY_SERVICE_ID);
const set = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
const S3_VARS = ["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

/** `https://host` for a bare host; `http://` for localhost (the local container rehearsal). */
export function originFromDomain(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(d);
  return `${local ? "http" : "https"}://${d}`;
}

/** Demo-only secret derived from the database URL (whoever holds DATABASE_URL already holds the data). */
function derive(databaseUrl: string, label: string): Buffer {
  return createHmac("sha256", databaseUrl).update(`bryels-care demo-only ${label} v1`).digest();
}

export function applyRuntimeDefaults(env: Env = process.env): Note[] {
  const notes: Note[] = [];
  const demo = demoModeState(env);

  // Public address: Origin checks on every form, links in emails and invitation links.
  if (set(env.APP_ORIGIN)) {
    const raw = env.APP_ORIGIN!.trim();
    const clean = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : originFromDomain(raw);
    if (clean !== env.APP_ORIGIN) {
      env.APP_ORIGIN = clean;
      notes.push({ level: "warn", setting: "APP_ORIGIN", message: `APP_ORIGIN was cleaned up to ${clean} (it must start with https:// and have no trailing slash).` });
    }
  } else if (set(env.RAILWAY_PUBLIC_DOMAIN)) {
    env.APP_ORIGIN = originFromDomain(env.RAILWAY_PUBLIC_DOMAIN!);
    notes.push({ level: "info", setting: "APP_ORIGIN", message: `APP_ORIGIN is not set, so the app uses Railway's public address ${env.APP_ORIGIN}.` });
  }

  // Client IP for the per-IP sign-in limits (docs/security.md §3.3). Railway's edge documents X-Real-IP.
  if (!set(env.TRUSTED_PROXY_HEADER) && onRailway(env)) {
    env.TRUSTED_PROXY_HEADER = "x-real-ip";
    notes.push({ level: "info", setting: "TRUSTED_PROXY_HEADER", message: "Using Railway's X-Real-IP header for the visitor's address (sign-in rate limits)." });
  }

  // File storage: a complete bucket configuration switches itself on.
  if (!set(env.FILE_STORAGE)) {
    if (S3_VARS.every((n) => set(env[n]))) {
      env.FILE_STORAGE = "s3";
      notes.push({ level: "info", setting: "FILE_STORAGE", message: "Bucket settings found (S3_*), so uploaded files are stored in the bucket." });
    } else if (demo.on && set(env.RAILWAY_VOLUME_MOUNT_PATH)) {
      env.FILE_STORAGE = "local";
      env.FILE_STORAGE_DIR = `${env.RAILWAY_VOLUME_MOUNT_PATH!.replace(/\/+$/, "")}/files`;
      notes.push({ level: "info", setting: "FILE_STORAGE", message: `Demo: uploaded files are stored on the attached volume (${env.FILE_STORAGE_DIR}). The worker cannot read them; a bucket is better.` });
    }
  }

  // Demo-only secrets: stable (derived, not random) so download links and two-step secrets survive restarts.
  if (demo.on && set(env.DATABASE_URL)) {
    if (!set(env.FILE_URL_SECRET)) {
      env.FILE_URL_SECRET = derive(env.DATABASE_URL!, "FILE_URL_SECRET").toString("base64url");
      notes.push({ level: "warn", setting: "FILE_URL_SECRET", message: "Demo only: FILE_URL_SECRET is not set, so one was derived from the database address. Never rely on this for real data." });
    }
    if (!set(env.DATA_ENCRYPTION_KEY)) {
      env.DATA_ENCRYPTION_KEY = `demo:${derive(env.DATABASE_URL!, "DATA_ENCRYPTION_KEY").toString("base64")}`;
      notes.push({ level: "warn", setting: "DATA_ENCRYPTION_KEY", message: "Demo only: DATA_ENCRYPTION_KEY is not set, so one was derived from the database address. Never rely on this for real data." });
    }
  }
  return notes;
}

/** Plain-language start-up report; `fatal` = the process cannot do anything useful and should stop. */
export function selfCheck(env: Env = process.env, service: Service = "web"): { fatal: boolean; notes: Note[] } {
  const notes = applyRuntimeDefaults(env);
  const demo = demoModeState(env);
  const production = env.NODE_ENV === "production";
  let fatal = false;

  const db = env.DATABASE_URL ?? "";
  if (!set(db)) {
    fatal = true;
    notes.unshift({ level: "error", setting: "DATABASE_URL", message: "Missing setting DATABASE_URL. In Railway open this service → Variables → New Variable, name DATABASE_URL, value ${{Postgres.DATABASE_URL}} (pick it from the Add Reference list if your database has another name)." });
  } else if (db.includes("${{")) {
    fatal = true;
    notes.unshift({ level: "error", setting: "DATABASE_URL", message: "DATABASE_URL still contains ${{…}}: the reference did not resolve. Check that the database service is really called Postgres, or re-pick the value from the Add Reference list." });
  } else if (!/^postgres(ql)?:\/\//i.test(db)) {
    fatal = true;
    notes.unshift({ level: "error", setting: "DATABASE_URL", message: "DATABASE_URL does not look like a database address (it must start with postgresql:// or postgres://). Re-pick it from the Add Reference list." });
  }

  if (demo.blockedByProduction) {
    notes.push({ level: "error", setting: "DEMO_MODE", message: `${demo.source}=true is ignored because APP_ENV=production. Demo data never runs on a production database.` });
  } else if (demo.on) {
    notes.push({ level: "info", setting: "DEMO_MODE", message: demo.source === "ALLOW_DEMO_SEED" ? "Demo mode is on (ALLOW_DEMO_SEED=true, the older name of DEMO_MODE=true)." : "Demo mode is on: fictional data, one-click demo accounts on the sign-in page." });
  }

  if (service !== "script") {
    if (!set(env.APP_ORIGIN)) {
      notes.push({
        level: production ? "warn" : "info",
        setting: "APP_ORIGIN",
        message: service === "worker"
          ? "APP_ORIGIN is not set on the worker, so links in emails it sends point to localhost. Add APP_ORIGIN = https://${{web.RAILWAY_PUBLIC_DOMAIN}} to the worker's Variables."
          : "APP_ORIGIN is not set and Railway has no public domain yet. Open the web service → Settings → Networking → Generate Domain, then redeploy.",
      });
    }
    if (production && !demo.on) {
      if (!set(env.FILE_URL_SECRET)) notes.push({ level: "warn", setting: "FILE_URL_SECRET", message: "Missing FILE_URL_SECRET: file downloads will say \"setup required\". Add a random value of 32+ characters to the web and worker Variables." });
      if (!set(env.DATA_ENCRYPTION_KEY)) notes.push({ level: "warn", setting: "DATA_ENCRYPTION_KEY", message: "Missing DATA_ENCRYPTION_KEY: two-step sign-in set-up will say \"setup required\". Add k1:<base64 of 32 random bytes> to the web and worker Variables." });
    }
    if (!set(env.FILE_STORAGE)) {
      notes.push({ level: production ? "warn" : "info", setting: "FILE_STORAGE", message: "No file storage: uploads (supplier certificates, photos, import files) will say \"File storage isn't set up\". Add a Railway Bucket and its S3_* variables (docs/railway-for-dummies.md step 7)." });
    }
    const provider = (env.EMAIL_PROVIDER ?? "none").trim().toLowerCase();
    if (provider === "none" || provider === "") notes.push({ level: "info", setting: "EMAIL_PROVIDER", message: "Email is not set up: invitation and password links are shown on screen to the administrator instead of being emailed." });
  }
  return { fatal, notes };
}

/** One line per note, readable in Railway's log viewer. */
export function formatNotes(notes: Note[]): string[] {
  const tag = { error: "PROBLEM", warn: "CHECK  ", info: "ok     " } as const;
  return notes.map((n) => `[setup] ${tag[n.level]} ${n.setting}: ${n.message}`);
}
