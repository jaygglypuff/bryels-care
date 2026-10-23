import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { buildXlsx } from "./export-xlsx";

/**
 * Export layer (US-2-21, FR-platform-11, docs/permissions-matrix.md §6 export restrictions,
 * docs/security.md §4.7). Every CSV/XLSX goes through `runExport`, which:
 * 1. requires the export's permission (module `.export` string) on top of the scoped query the
 *    definition's `fetch` runs with the caller's AuthContext (same scope as the screen);
 * 2. drops columns whose `requires` permission the caller lacks (masking) and says so in the header;
 * 3. refuses more rows than `platform.export.max_rows` (A-PM-17, default 50,000);
 * 4. neutralises formula injection in every string cell, quotes every CSV field, writes XLSX cells
 *    as strings only;
 * 5. writes a header block (generated at/by, site filter, filters, row count, markers);
 * 6. audits `platform.export.created` with filters, applied site scope, row count, format and hash.
 */
export type ExportFormat = "csv" | "xlsx";
export const EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx"];

export type ExportColumn<R> = {
  header: string;
  value: (row: R) => string | number | null | undefined;
  /** A numeric column: values must be plain decimals and are written unprefixed. */
  numeric?: boolean;
  /** Masked (omitted) unless the caller holds this permission (docs/permissions-matrix.md §6). */
  requires?: Permission;
  /** Marks the file as containing personal data. */
  personalData?: boolean;
};

export type ExportDefinition<F, R> = {
  /** Stable code, e.g. `inventory.availability`. */
  code: string;
  title: string;
  permission: Permission;
  /** N | S | R per the permission catalogue; R requires re-authentication within 10 minutes. */
  sensitivity: "N" | "S" | "R";
  columns: ExportColumn<R>[];
  /** Scoped fetch with the caller's context; must return at most `limit` rows. */
  fetch: (ctx: AuthContext, filters: F, limit: number) => Promise<R[]>;
  /** Sites the export covers after scoping (recorded in the header and the audit event). */
  siteScope: (ctx: AuthContext, filters: F) => string[];
  fileName: (filters: F) => string;
};

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** Prefixes a cell that a spreadsheet could read as a formula with a single quote. */
export function neutralizeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return FORMULA_START.test(s) ? `'${s}` : s;
}

function cell(col: { numeric?: boolean }, v: unknown): string {
  if (col.numeric && v !== null && v !== undefined && NUMERIC_RE.test(String(v))) return String(v);
  return neutralizeCell(v);
}

/** RFC 4180 CSV: every field quoted, CRLF line ends, UTF-8 with BOM for spreadsheet apps. */
export function toCsv(rows: string[][]): Buffer {
  const text = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
}

export type ExportFile = {
  fileName: string;
  contentType: string;
  body: Buffer;
  rowCount: number;
  sha256: string;
  maskedColumns: string[];
};

const manilaStamp = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) + " (Asia/Manila)";

export async function runExport<F extends Record<string, unknown>, R>(ctx: AuthContext, def: ExportDefinition<F, R>, filters: F, format: ExportFormat): Promise<ExportFile> {
  ctx.require(def.permission);
  if (!EXPORT_FORMATS.includes(format)) throw new DomainError("validation", "Choose CSV or XLSX.", { field: "format" });
  if (def.sensitivity === "R") {
    // Re-authentication (US-1-28) is not built yet; restricted exports stay refused rather than unprotected.
    throw new DomainError("reauth_required", "This export contains restricted data and needs you to sign in again first.");
  }
  const maxRows = await getSetting(db, ctx.organizationId, "platform.export.max_rows");
  const rows = await def.fetch(ctx, filters, maxRows + 1);
  if (rows.length > maxRows) {
    throw new DomainError("too_large", `This export has more than ${maxRows.toLocaleString("en-PH")} rows. Narrow the filters (date range, location, item) and try again.`, { maxRows });
  }
  const siteIds = def.siteScope(ctx, filters);
  for (const s of siteIds) ctx.requireSite(s);
  const visible = def.columns.filter((c) => !c.requires || ctx.can(c.requires));
  const masked = def.columns.filter((c) => c.requires && !ctx.can(c.requires)).map((c) => c.header);
  const personal = visible.some((c) => c.personalData);
  const siteLabel = siteIds.map((id) => ctx.allowedSites.find((s) => s.id === id)?.code ?? id).join(", ") || "none";
  const shownFilters = Object.entries(filters)
    .filter(([k, v]) => v !== undefined && v !== null && v !== "" && k !== "siteId")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("; ");
  const now = new Date();
  const header: string[][] = [
    [neutralizeCell(def.title)],
    ["Generated at", neutralizeCell(manilaStamp(now))],
    ["Generated by", neutralizeCell(`${ctx.displayName} <${ctx.email}>`)],
    ["Site filter", neutralizeCell(siteLabel)],
    ["Filters", neutralizeCell(shownFilters || "none")],
    ["Rows", String(rows.length)],
    ["Masked columns", neutralizeCell(masked.join(", ") || "none")],
    ["Contains personal data", personal ? "yes" : "no"],
    [],
  ];
  const table = [visible.map((c) => neutralizeCell(c.header)), ...rows.map((r) => visible.map((c) => cell(c, c.value(r))))];
  const all = [...header, ...table];
  const body = format === "csv" ? toCsv(all) : buildXlsx(all, def.title);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const fileName = `${def.fileName(filters)}-${stamp}.${format}`.replace(/[^A-Za-z0-9._-]/g, "_");
  await audit(db, ctx, {
    action: "platform.export.created",
    entityType: "export",
    entityNumber: def.code,
    siteId: siteIds.length === 1 ? siteIds[0] : null,
    after: { code: def.code, format, filters, siteScope: siteIds, rowCount: rows.length, sha256, maskedColumns: masked, fileName },
  });
  return {
    fileName,
    contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body,
    rowCount: rows.length,
    sha256,
    maskedColumns: masked,
  };
}

/** HTTP download response for an export file (no caching: the file reflects the caller's scope). */
export function exportResponse(file: ExportFile): Response {
  return new Response(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(file.rowCount),
      "X-Export-Sha256": file.sha256,
    },
  });
}
