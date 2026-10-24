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
  { name: "S3_ACCESS_KEY_ID", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "S3_SECRET_ACCESS_KEY", required: "optional", note: "when FILE_STORAGE=s3" },
  { name: "DEMO_MODE", required: "optional", note: "true = fictional demo (ADR-044); never on production" },
  { name: "APP_ROLE", required: "optional", note: "web | worker (scripts/start.sh); unset = from the service name" },
];

export const VARIABLE_ALLOW_LIST: Record<ServiceName, VariableSpec[]> = {
  web: [
    ...common,
    { name: "APP_ORIGIN", required: "production", note: "Origin checks, secure cookies" },
    { name: "TRUSTED_PROXY_HEADER", required: "production", note: "client IP for rate limits" },
    { name: "DATABASE_MIGRATION_URL", required: "optional", note: "pre-deploy migration only" },
    { name: "FILE_URL_SECRET", required: "production", note: "signed download links" },
    { name: "SESSION_SECRET", required: "optional", note: "planned (US-1-10)" },
    { name: "EMAIL_PROVIDER", required: "optional", note: "none = in-app only" },
    { name: "BACKUP_STATUS_SOURCE", required: "optional", note: "table = Backups card reads backup_runs" },
    { name: "MAINTENANCE_MODE", required: "optional", note: "1 = full outage for restores" },
  ],
  worker: [
    ...common,
    { name: "WORKER_CONCURRENCY", required: "optional", note: "default 2" },
    { name: "ALERT_WEBHOOK_URL", required: "optional", note: "chat webhook for alerts (not yet used)" },
  ],
};

/** name → present (non-empty) for this process. Never returns values. */
export function envPresence(service: ServiceName, env: NodeJS.ProcessEnv = process.env): Record<string, boolean> {
  return Object.fromEntries(VARIABLE_ALLOW_LIST[service].map((v) => [v.name, typeof env[v.name] === "string" && env[v.name]!.trim().length > 0]));
}
