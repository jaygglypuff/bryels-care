/**
 * Allow-listed environment variable NAMES per service (US-1-26 AC1, docs/deployment-railway.md §4).
 * Only presence is ever computed; values, connection strings and secrets never leave the process
 * (`diagnostics.no_secrets`). The worker reports its own presence map in its heartbeat row.
 */
export type ServiceName = "web" | "worker";
export type VariableSpec = { name: string; required: "always" | "production" | "optional"; note: string };

const common: VariableSpec[] = [
  { name: "NODE_ENV", required: "always", note: "set in the image" },
  { name: "APP_ENV", required: "production", note: "authoritative environment flag" },
  { name: "DATABASE_URL", required: "always", note: "runtime role bc_app" },
  { name: "LOG_LEVEL", required: "optional", note: "default info" },
  { name: "LOG_FORMAT", required: "optional", note: "json in staging/production" },
  { name: "RELEASE", required: "production", note: "release tag on logs and errors" },
  { name: "ERROR_REPORTING_DSN", required: "optional", note: "unset = error reporting disabled" },
  { name: "DATA_ENCRYPTION_KEY", required: "optional", note: "column encryption (later phases)" },
  { name: "FILE_STORAGE", required: "production", note: "local | s3" },
  { name: "S3_ENDPOINT", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "S3_BUCKET", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "S3_REGION", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "S3_ACCESS_KEY_ID", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "S3_SECRET_ACCESS_KEY", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "S3_FORCE_PATH_STYLE", required: "optional", note: "true for path-style S3 endpoints" },
  { name: "BREVO_API_KEY", required: "optional", note: "when EMAIL_PROVIDER=brevo" },
  { name: "RESEND_API_KEY", required: "optional", note: "when EMAIL_PROVIDER=resend" },
  { name: "EMAIL_FROM", required: "optional", note: "sender, e.g. Bryel's Care <noreply@your-domain>, when EMAIL_PROVIDER=brevo or resend" },
  { name: "DEMO_MODE", required: "optional", note: "true = fictional demo (ADR-055); never on production" },
  { name: "DEMO_PROFILE", required: "optional", note: "lite (default) | full: which demo DEMO_MODE loads" },
  { name: "APP_ROLE", required: "optional", note: "web | worker (scripts/start.sh); unset = from the service name" },
];

export const VARIABLE_ALLOW_LIST: Record<ServiceName, VariableSpec[]> = {
  web: [
    ...common,
    { name: "APP_ORIGIN", required: "production", note: "Origin checks, secure cookies" },
    { name: "TRUSTED_PROXY_HEADER", required: "production", note: "client IP for rate limits" },
    { name: "DATABASE_MIGRATION_URL", required: "optional", note: "pre-deploy migration only" },
    { name: "FILE_URL_SECRET", required: "production", note: "signed download links" },
    { name: "SESSION_SECRET", required: "optional", note: "not used (kept for compatibility); sessions are random tokens stored hashed" },
    { name: "EMAIL_PROVIDER", required: "optional", note: "none = in-app only; brevo or resend send real email" },
    { name: "BACKUP_STATUS_SOURCE", required: "optional", note: "table = Backups card reads backup_runs" },
    { name: "MAINTENANCE_MODE", required: "optional", note: "1 = 503 maintenance page for everything except /api/health and /api/ready (restores)" },
    { name: "BOOTSTRAP_ADMIN_EMAIL", required: "optional", note: "pnpm admin:bootstrap only; remove after the first administrator exists" },
    { name: "BOOTSTRAP_ADMIN_NAME", required: "optional", note: "pnpm admin:bootstrap only" },
    { name: "BOOTSTRAP_ADMIN_ROLES", required: "optional", note: "pnpm admin:bootstrap only; default owner_director,system_admin" },
    { name: "BOOTSTRAP_ORG_NAME", required: "optional", note: "pnpm admin:bootstrap on an empty database only" },
    { name: "BOOTSTRAP_SITE_CODE", required: "optional", note: "pnpm admin:bootstrap when no site exists" },
    { name: "BOOTSTRAP_SITE_NAME", required: "optional", note: "pnpm admin:bootstrap when no site exists" },
  ],
  worker: [
    ...common,
    { name: "WORKER_CONCURRENCY", required: "optional", note: "default 2" },
    { name: "ALERT_WEBHOOK_URL", required: "optional", note: "not built: chat delivery of alerts does not exist yet; alerts are in-app" },
  ],
};

/** name → present (non-empty) for this process. Never returns values. */
export function envPresence(service: ServiceName, env: NodeJS.ProcessEnv = process.env): Record<string, boolean> {
  return Object.fromEntries(VARIABLE_ALLOW_LIST[service].map((v) => [v.name, typeof env[v.name] === "string" && env[v.name]!.trim().length > 0]));
}
