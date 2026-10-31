import "server-only";
import { and, asc, desc, eq, isNull, lte, or, gt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { numberingRules, numberingRuleVersions } from "@/db/schema";
import { DomainError } from "@/lib/errors";

/**
 * Document numbers (ADR-009, docs/data-model.md §9). A number is allocated inside the caller's
 * transaction: the counter row of `numbering_rules` (one per document type and period key) is the
 * last lock a command takes, so a rolled-back command rolls its number back.
 *
 * How a number looks comes from the effective approved `numbering_rule_versions` row of the
 * document type (US-1-19), or the built-in default below (A-PRD-04) when no version was approved.
 * A new version never changes numbers already issued and, because counters are keyed by the
 * period key, continues the running sequence of the period (`continue_sequence_on_version`).
 */
export type ResetPeriod = "never" | "yearly" | "monthly" | "daily";
export type NumberingRuleSpec = { prefix: string; pattern: string; resetPeriod: ResetPeriod; sequenceWidth: number; isGapless: boolean };

const yearly = (prefix: string, width: number): NumberingRuleSpec => ({ prefix, pattern: "{PREFIX}-{YY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: width, isGapless: false });

/** Master-data codes (ADR-075, ADR-088): MAT-0001, WH-0001, LINE-0001…, never reset; past 9999 the number simply grows. */
const masterCode = (prefix: string): NumberingRuleSpec => ({ prefix, pattern: "{PREFIX}-{SEQ}", resetPeriod: "never", sequenceWidth: 4, isGapless: false });

/** Built-in defaults for the MVP document types (A-PRD-04; output identical to the pre-W2F formats). */
export const NUMBERING_DEFAULTS = {
  GR: yearly("GR", 5),
  LOT: { prefix: "L", pattern: "{PREFIX}-{YYMM}-{SEQ}", resetPeriod: "monthly", sequenceWidth: 5, isGapless: false },
  BATCH: yearly("B", 4),
  SO: yearly("SO", 5),
  DR: yearly("DR", 5),
  MOV: yearly("MOV", 6),
  QH: yearly("QH", 4), // Wave 1 W1B: quality holds (data-model §9.2)
  // Wave 1 W1C: boxes, transfers, counts, adjustments, reservations (data-model §9.2)
  BOX: { prefix: "BX", pattern: "{PREFIX}-{SEQ}", resetPeriod: "never", sequenceWidth: 8, isGapless: false },
  TR: yearly("TR", 6),
  CNT: yearly("CNT", 4),
  ADJ: yearly("ADJ", 5),
  RSV: yearly("RSV", 6),
  DOC: yearly("DOC", 7), // W1E: generated documents, organization scope (A-RPT-03)
  // Wave 2 W2C: inspections and deviations (data-model §9.2)
  INS: yearly("INS", 5),
  DEV: yearly("DEV", 4),
  // Wave 2 W2A: work orders and production plans (data-model §9.2)
  WO: yearly("WO", 5),
  PP: { prefix: "PP", pattern: "{PREFIX}-{YYMM}-{SEQ}", resetPeriod: "monthly", sequenceWidth: 3, isGapless: false },
  // Wave 3 W3D: quotations (data-model §9.2 QT-{YY}-{SEQ})
  QT: yearly("QT", 5),
  // Wave 3 W3E: packs, picks and shipments (data-model §9.2)
  PA: yearly("PA", 6),
  PK: yearly("PK", 6),
  SH: yearly("SH", 5),
  // Wave 3 W3F: complaints and customer returns (data-model §9.2)
  CMP: yearly("CMP", 4),
  RT: yearly("RT", 4),
  // Wave 3 W3C: import jobs and legacy documents (data-model §9.2)
  IMP: { prefix: "IMP", pattern: "{PREFIX}-{YYMM}-{SEQ}", resetPeriod: "monthly", sequenceWidth: 3, isGapless: false },
  LDOC: { prefix: "LDOC", pattern: "{PREFIX}-{SEQ}", resetPeriod: "never", sequenceWidth: 6, isGapless: false },
  // Wave 4 W4A: purchase requests, purchase orders, supplier returns (data-model §9.2)
  PR: yearly("PR", 5),
  PO: yearly("PO", 5),
  SRT: yearly("SRT", 4),
  // Wave 4 W4B: finance documents (data-model §9.2; only INV is gapless, A-DM-05 / A-FIN-05)
  INV: { prefix: "INV", pattern: "{PREFIX}-{YYYY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: 6, isGapless: true },
  BILL: yearly("BILL", 5),
  PAY: yearly("PAY", 6),
  CN: { prefix: "CN", pattern: "{PREFIX}-{YYYY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: 5, isGapless: false },
  EXP: yearly("EXP", 5),
  // Wave 4 W4C: CAPA, change control, recall cases (data-model §9.2) and maintenance (US-6-19)
  CAPA: yearly("CAPA", 3),
  CC: yearly("CC", 3),
  RC: { prefix: "RC", pattern: "{PREFIX}-{YYYY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: 2, isGapless: false },
  PM: { prefix: "PM", pattern: "{PREFIX}-{SEQ}", resetPeriod: "never", sequenceWidth: 4, isGapless: false },
  MWO: yearly("MWO", 4),
  // ADR-075: master-data codes the system assigns when the user leaves the code blank
  MAT: masterCode("MAT"),
  PRD: masterCode("PRD"),
  SUP: masterCode("SUP"),
  CUS: masterCode("CUS"),
  LOC: masterCode("LOC"),
  EQP: masterCode("EQP"),
  // ADR-088 (grade-5 standard): every set-up record is numbered by the system
  WH: masterCode("WH"),
  LINE: masterCode("LINE"),
  DEP: masterCode("DEP"),
  QCP: masterCode("QCP"),
  // Grade-5 pass of the recipe "advanced editing" screens: sellable items, recipes (advanced), steps and how-to sheets
  SKU: masterCode("SKU"),
  FRM: masterCode("F"),
  RTG: masterCode("R"),
  WI: masterCode("WI"),
} satisfies Record<string, NumberingRuleSpec>;

export type DocumentType = keyof typeof NUMBERING_DEFAULTS;
export const DOCUMENT_TYPES = Object.keys(NUMBERING_DEFAULTS) as DocumentType[];

export function isDocumentType(t: string): t is DocumentType {
  return Object.prototype.hasOwnProperty.call(NUMBERING_DEFAULTS, t);
}

/** Calendar parts in the business timezone (A-PRD: Asia/Manila; site timezones arrive with site-scoped rules). */
function localParts(now: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = f.format(now).split("-");
  return { yyyy: y, yy: y.slice(2), mm: m, dd: d };
}

/** Business date (YYYY-MM-DD, Asia/Manila) used for effective dates. */
export function numberingBusinessDate(now = new Date()): string {
  const p = localParts(now);
  return `${p.yyyy}-${p.mm}-${p.dd}`;
}

/** Counter key per reset period; identical to the pre-W2F keys so running sequences continue. */
export function periodKeyFor(reset: ResetPeriod, now = new Date()): string {
  const p = localParts(now);
  return reset === "yearly" ? p.yy : reset === "monthly" ? p.yy + p.mm : reset === "daily" ? p.yy + p.mm + p.dd : "";
}

const TOKENS = ["PREFIX", "SITE", "YYYY", "YY", "YYMM", "YYMMDD", "SEQ"] as const;

/**
 * Pattern rules of docs/data-model.md §9.4 (mirrored by CHECK constraints on
 * `numbering_rule_versions`). Returns field → message; empty when valid.
 */
export function validateNumberingRule(r: NumberingRuleSpec & { scope?: "organization" | "site" }): Record<string, string> {
  const e: Record<string, string> = {};
  if (!/^[A-Z0-9]{1,8}$/.test(r.prefix)) e.prefix = "Use 1 to 8 capital letters or digits.";
  if (!Number.isInteger(r.sequenceWidth) || r.sequenceWidth < 1 || r.sequenceWidth > 12) e.sequenceWidth = "Width must be between 1 and 12.";
  const p = r.pattern;
  const unknown = [...p.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((t) => !(TOKENS as readonly string[]).includes(t));
  if (unknown.length) e.pattern = `Unknown token {${unknown[0]}}. Allowed: ${TOKENS.map((t) => `{${t}}`).join(", ")}.`;
  else if (!/^([A-Z0-9._-]|\{(PREFIX|SITE|YYYY|YY|YYMM|YYMMDD|SEQ)\})+$/.test(p)) e.pattern = "Only capital letters, digits, '-', '.', '_' and the listed tokens are allowed.";
  else if ((p.match(/\{SEQ\}/g) ?? []).length !== 1) e.pattern = "The pattern must contain {SEQ} exactly once.";
  else if (r.scope === "site" && !p.includes("{SITE}")) e.pattern = "A site-specific rule must contain {SITE}.";
  else if (r.scope !== "site" && p.includes("{SITE}")) e.pattern = "{SITE} is only allowed in a site-specific rule.";
  else if (r.resetPeriod === "daily" && !p.includes("{YYMMDD}")) e.pattern = "A daily reset needs {YYMMDD} in the pattern.";
  else if (r.resetPeriod === "monthly" && !/\{YYMM(DD)?\}/.test(p)) e.pattern = "A monthly reset needs {YYMM} or {YYMMDD} in the pattern.";
  else if (r.resetPeriod === "yearly" && !/\{(YYYY|YY|YYMM|YYMMDD)\}/.test(p)) e.pattern = "A yearly reset needs a year token in the pattern.";
  if (!["never", "yearly", "monthly", "daily"].includes(r.resetPeriod)) e.resetPeriod = "Choose never, yearly, monthly or daily.";
  return e;
}

/** Pure formatter shared by allocation, preview and tests. */
export function formatNumber(rule: Pick<NumberingRuleSpec, "prefix" | "pattern" | "sequenceWidth">, seq: number, now = new Date(), siteCode?: string): string {
  const p = localParts(now);
  const values: Record<string, string> = {
    PREFIX: rule.prefix,
    SITE: siteCode ?? "",
    YYYY: p.yyyy,
    YY: p.yy,
    YYMM: p.yy + p.mm,
    YYMMDD: p.yy + p.mm + p.dd,
    SEQ: String(seq).padStart(rule.sequenceWidth, "0"),
  };
  return rule.pattern.replace(/\{(PREFIX|SITE|YYYY|YYMMDD|YYMM|YY|SEQ)\}/g, (_m, t: string) => values[t]);
}

export type EffectiveNumberingRule = NumberingRuleSpec & { source: "default" | "version"; versionId: string | null; versionNo: number | null; effectiveFrom: string | null };

/** The rule in force for a document type on `now` (approved version, else the built-in default). */
export async function effectiveNumberingRule(q: DbOrTx, organizationId: string, documentType: DocumentType, now = new Date()): Promise<EffectiveNumberingRule> {
  const day = numberingBusinessDate(now);
  const [v] = await q
    .select()
    .from(numberingRuleVersions)
    .where(
      and(
        eq(numberingRuleVersions.organizationId, organizationId),
        eq(numberingRuleVersions.documentType, documentType),
        isNull(numberingRuleVersions.siteId),
        eq(numberingRuleVersions.status, "approved"),
        lte(numberingRuleVersions.effectiveFrom, day),
        or(isNull(numberingRuleVersions.effectiveTo), gt(numberingRuleVersions.effectiveTo, day)),
      ),
    )
    .orderBy(desc(numberingRuleVersions.effectiveFrom))
    .limit(1);
  if (v) {
    return { prefix: v.prefix, pattern: v.pattern, resetPeriod: v.resetPeriod as ResetPeriod, sequenceWidth: v.sequenceWidth, isGapless: v.isGapless, source: "version", versionId: v.id, versionNo: v.versionNo, effectiveFrom: v.effectiveFrom };
  }
  const d = NUMBERING_DEFAULTS[documentType];
  if (!d) throw new DomainError("setup_required", `NUMBERING_RULE_MISSING: no numbering rule for ${documentType}.`, { code: "NUMBERING_RULE_MISSING" });
  return { ...d, source: "default", versionId: null, versionNo: null, effectiveFrom: null };
}

/**
 * Allocates the next number inside the caller's transaction (row lock via upsert, the last lock
 * of the command), e.g. GR-26-00012, L-2610-00171, B-26-0012.
 */
export async function nextNumber(tx: DbOrTx, organizationId: string, documentType: DocumentType, now = new Date()): Promise<string> {
  const { rule, seq } = await allocateSequence(tx, organizationId, documentType, now);
  if (String(seq).length > rule.sequenceWidth) {
    throw new DomainError("conflict", `NUMBER_OVERFLOW: ${documentType} numbers of this period exceed ${rule.sequenceWidth} digits; approve a wider numbering rule.`, { code: "NUMBER_OVERFLOW" });
  }
  return formatNumber(rule, seq, now);
}

/** Row-locked counter increment shared by document numbers and master-data codes. */
async function allocateSequence(tx: DbOrTx, organizationId: string, documentType: DocumentType, now: Date) {
  if (!isDocumentType(documentType)) throw new DomainError("setup_required", `NUMBERING_RULE_MISSING: no numbering rule for ${String(documentType)}.`, { code: "NUMBERING_RULE_MISSING" });
  const rule = await effectiveNumberingRule(tx, organizationId, documentType, now);
  const pk = periodKeyFor(rule.resetPeriod, now);
  const rows = await tx.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${documentType}, ${rule.prefix}, ${rule.sequenceWidth}, ${pk}, 2)
    ON CONFLICT (organization_id, document_type, period_key)
    DO UPDATE SET next_value = numbering_rules.next_value + 1, prefix = excluded.prefix, sequence_width = excluded.sequence_width
    RETURNING (next_value - 1)::text AS value`);
  return { rule, seq: Number(rows[0].value) };
}

/** Master-data code types (ADR-075). */
export const MASTER_CODE_TYPES = ["MAT", "PRD", "SUP", "CUS", "LOC", "EQP", "WH", "LINE", "DEP", "QCP", "SKU", "FRM", "RTG", "WI"] as const;
export type MasterCodeType = (typeof MASTER_CODE_TYPES)[number];

/**
 * The next free master-data code (MAT-0001, SUP-0002, ...) for a record whose code was left blank.
 * The counter row of `numbering_rules` stays locked until the caller's transaction ends, so two
 * creates at the same moment get different codes. `taken` says whether a code is already used
 * (typed by hand earlier, or imported); such numbers are skipped. Past the width the number
 * simply grows (MAT-10000): master codes never overflow.
 */
export async function assignMasterCode(tx: DbOrTx, organizationId: string, type: MasterCodeType, taken: (code: string) => Promise<boolean>, now = new Date()): Promise<string> {
  for (let i = 0; i < 10_000; i += 1) {
    const { rule, seq } = await allocateSequence(tx, organizationId, type, now);
    const code = formatNumber(rule, seq, now);
    if (!(await taken(code))) return code;
  }
  throw new DomainError("conflict", `Could not find a free ${type} code; type a code instead.`, { field: "code" });
}

/**
 * The number the next allocation would most likely produce ("expected", no lock). Refused for
 * gapless types, whose numbers exist only once the posting commits (docs/data-model.md §9.3 rule 4).
 */
export async function peekNextNumber(q: DbOrTx, organizationId: string, documentType: DocumentType, now = new Date()): Promise<string> {
  const rule = await effectiveNumberingRule(q, organizationId, documentType, now);
  if (rule.isGapless) throw new DomainError("validation", `${documentType} numbers are gapless and cannot be previewed.`, { code: "PEEK_REFUSED_GAPLESS" });
  const pk = periodKeyFor(rule.resetPeriod, now);
  const [c] = await q
    .select({ next: numberingRules.nextValue })
    .from(numberingRules)
    .where(and(eq(numberingRules.organizationId, organizationId), eq(numberingRules.documentType, documentType), eq(numberingRules.periodKey, pk)))
    .limit(1);
  return formatNumber(rule, c?.next ?? 1, now);
}

/** Counter rows of an organization (admin screen): one per document type and period. */
export async function listNumberingCounters(q: DbOrTx, organizationId: string) {
  return q
    .select({ documentType: numberingRules.documentType, periodKey: numberingRules.periodKey, nextValue: numberingRules.nextValue, prefix: numberingRules.prefix })
    .from(numberingRules)
    .where(eq(numberingRules.organizationId, organizationId))
    .orderBy(asc(numberingRules.documentType), desc(numberingRules.periodKey));
}
