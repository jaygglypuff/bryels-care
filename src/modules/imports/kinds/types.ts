import type { DbOrTx, Tx } from "@/db/client";
import type { importJobs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import type { RowReader } from "./values";

/**
 * Contract of one import kind (docs/data-migration-plan.md §9.2). The engine (src/modules/imports/engine.ts)
 * does everything generic: mapping, chunking, savepoints, duplicate bookkeeping, results, audit. A kind only
 * (1) reads and checks one row's values (pure, no database), (2) names its duplicate keys, (3) finds
 * existing records for tier 1–3 matches and (4) creates the record through the owning module's service,
 * so an import follows exactly the rules of the screens. Validation runs `create` too, inside a
 * transaction that is rolled back (dry run).
 */
export type ImportJobRow = typeof importJobs.$inferSelect;

export type ColumnSpec = {
  /** Template header and mapping target (snake_case, as in §9.2). */
  key: string;
  label: string;
  required?: boolean;
  hint: string;
  /** Other header spellings matched automatically at the mapping step (lower-case, spaces as "_"). */
  aliases?: string[];
};

export type RowIssue = { field: string; message: string };

export type Normalized<V> = {
  values: V;
  /** Tier 1 (same record) key within the file and against existing records; null = never a duplicate. */
  tier1Key?: string | null;
  /** Rows sharing a group key are validated and posted in the same chunk (e.g. one opening lot). */
  groupKey?: string | null;
  /** Name compared within the file for tier 2 candidates (normalised equality, §8). */
  matchName?: string | null;
};

export type ExistingMatch = { tier: 1 | 2 | 3; entityType: string; entityId: string; label: string; message: string };

export type CreatedEntity = { entityType: string; entityId: string; label: string; hold?: boolean; warnings?: string[] };

/** Per-run scratch state shared by the rows of one chunk transaction (e.g. the opening receipt per warehouse). */
export type KindRunState = Map<string, unknown>;

export type CreateContext = {
  ctx: AuthContext;
  tx: Tx;
  job: ImportJobRow;
  row: { id: string; rowNo: number };
  dryRun: boolean;
  state: KindRunState;
};

export type KindAvailability = { available: true } | { available: false; reason: string };

export type ImportKindHandler<V = Record<string, unknown>> = {
  kind: string;
  label: string;
  description: string;
  /** The entity created per row (crosswalk report). */
  creates: string;
  /** Permissions the poster needs besides platform.import_job.post (also enforced by the services). */
  entityPermissions: Permission[];
  columns: ColumnSpec[];
  /** Clearly fictional example rows for the downloadable template. */
  exampleRows: Record<string, string>[];
  availability: KindAvailability;
  /** The kind needs uploaded scans (legacy documents). */
  needsScans?: boolean;
  /** Opening stock: guarded by MIGRATION_WINDOW_OPEN in production (A-MIG-08). */
  requiresMigrationWindow?: boolean;
  /** Pure checks of one row; errors and warnings go to the reader. Return null when the row is unusable. */
  normalize(r: RowReader): Normalized<V> | null;
  /** Tier 1/2/3 matches against existing records, keyed by row number. */
  findExisting?(tx: DbOrTx, ctx: AuthContext, job: ImportJobRow, rows: { rowNo: number; values: V }[]): Promise<Map<number, ExistingMatch>>;
  /** Creates the record(s) of one row through the owning service, inside `k.tx` (a savepoint). */
  create(k: CreateContext, values: V): Promise<CreatedEntity>;
  /** Custodian chose "same as existing" for a tier 2/3 candidate (e.g. record the old name as an alias). */
  linkToExisting?(k: CreateContext, values: V, match: { entityType: string; entityId: string }): Promise<void>;
  /** Warnings that need several rows (e.g. the same supplier lot with two expiry dates), keyed by row number. */
  fileChecks?(rows: { rowNo: number; values: V }[]): Map<number, string[]>;
  /**
   * Reverses what a posted job created (platform.import_job.void). Kinds without it cannot be voided:
   * their records are corrected on the master-data screens (deactivate or discontinue).
   */
  voidPosted?(k: { ctx: AuthContext; tx: Tx; job: ImportJobRow; reason: string }): Promise<Record<string, unknown>>;
};
