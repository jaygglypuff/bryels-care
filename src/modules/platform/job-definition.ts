import type { z } from "zod";
import type { backgroundJobs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";

/**
 * The job contract (docs/architecture.md §8). A module ships a job as one file that calls
 * `defineJob(...)`; the integrator adds it to the list in `job-handlers.ts` (one import line plus
 * one list entry). This file has no runtime dependencies so any module can import it without
 * creating an import cycle.
 */
export type BackgroundJobRow = typeof backgroundJobs.$inferSelect;

export type JobRunContext = {
  /** `system:<code>` context; on behalf of the triggering user (rebuilt from current access) when there is one. */
  ctx: AuthContext;
  job: BackgroundJobRow;
  /** 1 for the first run. */
  attempt: number;
  /** `<code>:<key tuple>`; use it (or derive from it) for every posting so a retry never posts twice. */
  idempotencyKey: string;
  correlationId: string;
  /** The runner's clock; tests pass a fixed date. */
  asOf: Date;
};

export type JobResult = Record<string, unknown> | void;

export type JobDefinition<P = unknown> = {
  /** `<module>.<job_name>` registered in docs/architecture.md §8. */
  code: string;
  title: string;
  description: string;
  /** Zod schema (use `.strict()`); the payload is validated at enqueue and again before every run. */
  payload: z.ZodType<P>;
  /** Idempotency key tuple; the key is `<code>:<tuple joined by ":">` (rule 3). */
  keyTuple: (payload: P) => (string | number | null | undefined)[];
  /** The handler. Throw to fail the attempt; a DomainError is permanent (no retry), anything else retries. */
  run: (run: JobRunContext, payload: P) => Promise<JobResult>;
  /** Permissions of the system context when no user triggered the job (scheduled jobs). */
  systemPermissions?: Permission[];
  /** Recurring trigger (pg-boss schedule in the worker); `payload` builds the payload for a tick. */
  schedule?: { cron: string; tz: string; payload: (now: Date) => P };
  /** Attempts before dead-lettering; default: setting `platform.jobs.max_attempts` (5). */
  maxAttempts?: number;
  /** First retry delay in seconds (exponential backoff); default 30. */
  retryDelaySeconds?: number;
  /** A running attempt older than this is considered lost and may be re-claimed; default 900. */
  timeoutSeconds?: number;
  /** Payload summary for the diagnostics card; default: the payload with secret-like keys masked. */
  summarize?: (payload: P) => Record<string, unknown>;
};

export const JOB_CODE_RE = /^[a-z]+\.[a-z_]+(\.[a-z_]+)?$/;

/** Declares a job. Throws at module load when the code does not follow the registry pattern. */
export function defineJob<P>(def: JobDefinition<P>): JobDefinition<P> {
  if (!JOB_CODE_RE.test(def.code)) throw new Error(`Job code "${def.code}" does not match <module>.<job_name> (docs/architecture.md §8 rule 1).`);
  return def;
}

/** Payload types differ per job; each definition is fully typed where it is declared. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJobDefinition = JobDefinition<any>;

export type JobRegistry = {
  get(code: string): AnyJobDefinition | undefined;
  has(code: string): boolean;
  list(): AnyJobDefinition[];
};

/** Builds a registry; a duplicate code is a programming error and throws. */
export function createJobRegistry(defs: AnyJobDefinition[]): JobRegistry {
  const map = new Map<string, AnyJobDefinition>();
  for (const d of defs) {
    if (map.has(d.code)) throw new Error(`Job code ${d.code} is registered twice.`);
    map.set(d.code, d);
  }
  return {
    get: (code) => map.get(code),
    has: (code) => map.has(code),
    list: () => [...map.values()],
  };
}
