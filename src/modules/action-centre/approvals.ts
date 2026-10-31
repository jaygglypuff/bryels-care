import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, roles, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { fmtMoney } from "@/lib/qty";
import { settingDefinition } from "@/lib/settings";
import { type ApprovalVerdict, OWN_REQUEST_REASON } from "@/modules/governance";
import { type ActionItemView, listActionItems } from "./items";

/**
 * "To approve" (ADR-075, ADR-082 §4, owner QA 2026-10-30): everything waiting for a decision, split in
 * two. `decidable` = items the signed-in user can decide *now*: the kind's approval permission at the
 * item's site (action-centre visibility), the open approval step's permission and roles (with
 * escalation), and the same-person rules (requester, earlier-step approver) — computed by the owning
 * module's verdict function with the rules its decide service enforces. `waiting` = items the user may
 * see but someone else must decide now ("Waiting for the site manager"); they never get an Approve
 * button. The header badge (`myApprovalCount`) is the number of decidable rows, from the same function.
 *
 * Modules register a verdict function per kind (`registerApprovalGate`, wired in src/modules/wiring.ts;
 * the action centre never imports them). Kinds without one fall back to: permission at the site (already
 * required to see the item) and "not your own request" (from the record's audit trail).
 */
export type ApprovalGate = (ctx: AuthContext, entityIds: string[]) => Promise<Map<string, ApprovalVerdict>>;

const GATES_KEY = "__bc_approval_gates__";
function gates(): Map<string, ApprovalGate> {
  const g = globalThis as unknown as Record<string, Map<string, ApprovalGate> | undefined>;
  g[GATES_KEY] ??= new Map();
  return g[GATES_KEY]!;
}

/** Plug-in point: the module that owns `kind` says who can decide its records now. Re-registering replaces. */
export function registerApprovalGate(kind: string, gate: ApprovalGate) {
  gates().set(kind, gate);
}

export type ApprovalRow = ActionItemView & {
  requestedBy: { id: string | null; name: string | null; at: Date | null };
  /** The signed-in user asked for this (someone else decides unless the owner override is on). */
  ownRequest: boolean;
  /** The signed-in user may decide the open step now (Approve / Reject shown). */
  canDecide: boolean;
  /** ADR-088 §2: plain words when a top role decides their own request ("You can approve this yourself because you are the owner."). */
  selfApprovalNote: string | null;
  /** Plain words for the "Waiting for others" section, e.g. "Waiting for the site manager". */
  waitingFor: string | null;
  /** Label of the open approval step, when the record has steps. */
  stepLabel: string | null;
  /** Plain title for the row (no raw keys). */
  displayTitle: string;
  /** Record number worth showing (document numbers only; never a raw key). */
  displayNumber: string | null;
  /** Why the record needs approval, when the data says it. */
  why: string | null;
  /** Value of the record, formatted (₱12,768.00), when there is one and the user may see it. */
  amountText: string | null;
  /** Short noun for the confirmation sentence ("expense claim EXP-26-00001"). */
  what: string;
};

/** Audit actions that mean "asked for a decision", most specific first. */
const ASK = ["submitted", "requested", "sent_for_approval", "release_requested", "reopen_requested"];

/** Kinds whose record number is a raw key rather than a document number. */
const NO_NUMBER = new Set(["approval.setting_change", "approval.customer_requirement", "approval.template_version", "approval.price_list"]);

/** "platform.rate_limits" / "min_remaining_shelf_life_days" → "Platform rate limits" / "Min remaining shelf life days". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Replaces raw identifiers (`a.b_c`, `x_y`) inside a sentence by plain words; leaves emails and numbers alone. */
export function cleanSentence(text: string): string {
  return text.replace(/(?<![@\w.-])([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)(?![@\w-])/g, (m) => humanizeKey(m).toLowerCase());
}

export function formatAmount(amount: string | null | undefined, currency: string | null | undefined): string | null {
  if (amount == null || amount === "") return null;
  const peso = fmtMoney(amount);
  return !currency || currency === "PHP" ? peso : `${currency} ${peso.slice(1)}`;
}

function settingTitle(key: string): string {
  const def = settingDefinition(key);
  return `Setting change: ${def?.label ?? humanizeKey(key)}`;
}

async function roleNames(organizationId: string, codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = await db.select({ code: roles.code, name: roles.name }).from(roles).where(and(eq(roles.organizationId, organizationId), inArray(roles.code, codes)));
  return new Map(rows.map((r) => [r.code, r.name]));
}

function waitingText(roleCodes: string[], names: Map<string, string>, blockedReason: string | null): string {
  if (blockedReason) return blockedReason;
  if (!roleCodes.length) return "Waiting for someone else with approval rights";
  // "Site manager" → "the site manager"; acronyms ("QA/QC") keep their case.
  // "Site Manager" → "the site manager", "Finance" → "finance", "QA/QC" stays.
  const plain = (n: string) => {
    const words = n.split(/\s+/).map((w) => (/^[A-Z0-9/&]+$/.test(w) && w.length > 1 ? w : w.toLowerCase()));
    return words.length > 1 ? `the ${words.join(" ")}` : words[0];
  };
  const list = roleCodes.map((c) => plain(names.get(c) ?? humanizeKey(c)));
  return `Waiting for ${list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}` : list[0]}`;
}

async function requesters(ctx: AuthContext, ids: string[]) {
  if (!ids.length) return new Map<string, { actorId: string | null; name: string | null; at: Date; action: string }>();
  const evs = await db
    .select({ entityId: auditEvents.entityId, action: auditEvents.action, actorId: auditEvents.actorId, name: users.displayName, at: auditEvents.occurredAt })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(
      and(
        eq(auditEvents.organizationId, ctx.organizationId),
        inArray(auditEvents.entityId, ids),
        or(...ASK.map((a) => sql`${auditEvents.action} like ${"%." + a}`), sql`${auditEvents.action} like '%.created'`, sql`${auditEvents.action} like '%.drafted'`),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(5000);
  const byEntity = new Map<string, { actorId: string | null; name: string | null; at: Date; action: string }>();
  for (const e of evs) {
    if (!e.entityId) continue;
    const cur = byEntity.get(e.entityId);
    const asks = ASK.some((a) => e.action.endsWith("." + a));
    // Newest "asked" event wins; a "created" event only when nothing asked yet.
    if (!cur || (asks && !ASK.some((a) => cur.action.endsWith("." + a)))) byEntity.set(e.entityId, e);
  }
  return byEntity;
}

/** Every approval item the user may see, each with `canDecide` and, when not, who it waits for. */
export async function listMyApprovals(ctx: AuthContext): Promise<ApprovalRow[]> {
  const items = await listActionItems(ctx, { tab: "approvals", includeAcknowledged: true });
  if (!items.length) return [];
  const byEntity = await requesters(ctx, [...new Set(items.map((i) => i.entityId))]);

  // Module verdicts, one call per kind.
  const verdicts = new Map<string, ApprovalVerdict>();
  const gated = new Set<string>();
  const kinds = [...new Set(items.map((i) => i.kind))];
  for (const kind of kinds) {
    const gate = gates().get(kind);
    if (!gate) continue;
    try {
      const m = await gate(ctx, items.filter((i) => i.kind === kind).map((i) => i.entityId));
      gated.add(kind);
      for (const [id, v] of m) verdicts.set(`${kind}:${id}`, v);
    } catch {
      // A failing verdict never hides the list: the kind falls back to the generic rule below.
    }
  }
  const names = await roleNames(ctx.organizationId, [...new Set([...verdicts.values()].flatMap((v) => v.waitingForRoles))]);

  const rows: ApprovalRow[] = [];
  for (const i of items) {
    const v = verdicts.get(`${i.kind}:${i.entityId}`);
    // A gated kind that did not return the record: it is no longer waiting (decided since the last sweep) or
    // is outside the caller's sites. It is left out rather than offered with a button that would fail.
    if (gated.has(i.kind) && !v) continue;
    const e = byEntity.get(i.entityId);
    const requestedBy = { id: v?.requestedById ?? e?.actorId ?? null, name: v?.requestedByName ?? e?.name ?? null, at: e?.at ?? i.openedAt };
    const ownRequest = !!requestedBy.id && requestedBy.id === ctx.userId;
    const canDecide = v ? v.canDecide : !ctx.sodConflict(requestedBy.id);
    const blocked = v ? v.blockedReason : ctx.sodConflict(requestedBy.id) ? OWN_REQUEST_REASON : null;
    const kindNoun = i.kindLabel.replace(/ to (approve|decide|release|review)$/i, "").replace(/ waiting for .*$/i, "");
    const rawTitle =
      v?.title ??
      (i.kind === "approval.setting_change" && i.recordNumber ? settingTitle(i.recordNumber) : cleanSentence(i.title.replace(/ waits for (approval|review|release|a QA decision|a second QA approver)$/i, "")));
    // The number is shown once: not again in front of a title that already contains it ("Adjustment ADJ-26-00001").
    const displayNumber = NO_NUMBER.has(i.kind) || (i.recordNumber && rawTitle.includes(i.recordNumber)) ? null : i.recordNumber;
    const displayTitle = rawTitle;
    const amountText = formatAmount(v?.amount, v?.currency);
    rows.push({
      ...i,
      requestedBy,
      ownRequest,
      canDecide,
      selfApprovalNote: canDecide && v?.ownRequest ? (v.selfApprovalNote ?? null) : null,
      waitingFor: canDecide ? null : waitingText(v?.waitingForRoles ?? [], names, blocked),
      // The step label only when it adds something to "Waiting for the site manager" ("… above 10 % discount").
      stepLabel: v?.stepLabel && !(canDecide ? "" : waitingText(v.waitingForRoles ?? [], names, blocked)).toLowerCase().includes(v.stepLabel.replace(/\s*\bapproval\b.*$/i, "").toLowerCase()) ? v.stepLabel : null,
      displayTitle,
      displayNumber,
      why: v?.why ? cleanSentence(v.why) : null,
      amountText,
      // Detector details that only repeat the amount ("12768.00 PHP") are dropped in favour of amountText.
      // Kinds whose detector detail only repeats a raw key (customer requirement kind) drop it when the module gave a title.
      detail: i.detail && !(NO_NUMBER.has(i.kind) && v?.title) && !(amountText && /^(₱|[A-Z]{3} )?[\d.,]+(\s*[A-Z]{3})?$/.test(i.detail.trim())) ? cleanSentence(i.detail) : null,
      what: [amountText, kindNoun.toLowerCase(), displayNumber, requestedBy.name ? `from ${requestedBy.name}` : null].filter(Boolean).join(" "),
    });
  }
  return rows.sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || a.openedAt.getTime() - b.openedAt.getTime());
}

/** The "To approve" page: what the user decides now, and what waits for someone else. */
export async function myApprovalInbox(ctx: AuthContext): Promise<{ decidable: ApprovalRow[]; waiting: ApprovalRow[] }> {
  const rows = await listMyApprovals(ctx);
  return { decidable: rows.filter((r) => r.canDecide), waiting: rows.filter((r) => !r.canDecide) };
}

/** Badge count for the "To approve" entry: exactly the number of decidable rows of the page. */
export async function myApprovalCount(ctx: AuthContext): Promise<number> {
  return (await listMyApprovals(ctx)).filter((r) => r.canDecide).length;
}
