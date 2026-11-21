import Decimal from "decimal.js";
import { TAKEOUT_PURPOSES } from "../../db/schema/takeouts";

/**
 * ADR-138 "Take a few out": the pure rules (no I/O; unit tested in tests/unit/takeout-rules.test.ts). The service
 * (takeouts.ts) and the screens use these words and decisions, so the phone, the list and the server agree.
 */

export type TakeoutPurpose = (typeof TAKEOUT_PURPOSES)[number];
export type TakeoutStatus = "awaiting_approval" | "posted" | "rejected" | "cancelled" | "reversed";

/** The reasons, in the order the phone shows them, with the words people read. */
export const PURPOSE_WORDS: Record<TakeoutPurpose, { label: string; short: string; hint: string }> = {
  sold_online: { label: "Sold online", short: "Online order", hint: "An order from an online shop (Shopee, Lazada…)." },
  customer_sample: { label: "Sample for a customer", short: "Sample", hint: "Free pieces for a customer or someone who may buy." },
  giveaway: { label: "Giveaway or marketing", short: "Giveaway", hint: "A gift, a raffle prize, a post for social media." },
  display: { label: "Display or shop shelf", short: "Display", hint: "Put on show in the shop or at an event." },
  staff_use: { label: "Staff use", short: "Staff use", hint: "Used or given to staff." },
  other: { label: "Other (say what)", short: "Other", hint: "Write what happened." },
};

export const STATUS_WORDS: Record<TakeoutStatus, string> = {
  awaiting_approval: "Waiting for OK",
  posted: "Taken out",
  rejected: "Not approved",
  cancelled: "Cancelled",
  reversed: "Undone",
};

export const isPurpose = (v: unknown): v is TakeoutPurpose => typeof v === "string" && (TAKEOUT_PURPOSES as readonly string[]).includes(v);

/** Typed transition table of the `stock_takeout` state machine (data-model §3.3a). A new entry starts in posted or awaiting_approval. */
export const TAKEOUT_TRANSITIONS: Record<TakeoutStatus, readonly TakeoutStatus[]> = {
  awaiting_approval: ["posted", "rejected", "cancelled"],
  posted: ["reversed"],
  rejected: [],
  cancelled: [],
  reversed: [],
};

export type LimitInput = {
  /** Pieces per line of this entry. */
  lines: Decimal.Value[];
  /** Pieces this person already took out today (posted or waiting, not undone, not refused). */
  takenTodayByPerson: Decimal.Value;
  maxPerLine: number;
  maxPerPersonDay: number;
};

/**
 * Whether the entry posts at once or waits for an OK (settings `inventory.takeout.max_pieces_per_line` and
 * `inventory.takeout.max_pieces_per_person_day`). Returns null when it may post, else the plain reason.
 */
export function limitReason(i: LimitInput): string | null {
  const reasons: string[] = [];
  const biggest = i.lines.reduce<Decimal>((m, q) => Decimal.max(m, new Decimal(q)), new Decimal(0));
  if (biggest.gt(i.maxPerLine)) reasons.push(`${biggest.toString()} pieces of one product (up to ${i.maxPerLine} go out without an OK)`);
  const total = i.lines.reduce<Decimal>((s, q) => s.plus(q), new Decimal(0));
  const day = new Decimal(i.takenTodayByPerson).plus(total);
  if (day.gt(i.maxPerPersonDay)) reasons.push(`${day.toString()} pieces by you today (up to ${i.maxPerPersonDay} a day go out without an OK)`);
  if (!reasons.length) return null;
  const s = reasons.join(" and ");
  return s[0].toUpperCase() + s.slice(1) + ".";
}

/**
 * Who may undo a posted take-out (ADR-138 §2): the person who recorded it, the same Manila day; anyone holding
 * `inventory.takeout.void` at the site, any time. Returns null when allowed, else the plain reason.
 */
export function undoRefusal(i: { createdBy: string; postedAt: Date | null; userId: string; canVoid: boolean; now?: Date }): string | null {
  if (i.canVoid) return null;
  if (i.createdBy !== i.userId) return "Only the person who took them out (the same day) or a site manager can undo this.";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  if (!i.postedAt || day(i.postedAt) !== day(i.now ?? new Date())) return "You can undo your own take-out only on the same day. Ask the site manager to undo it.";
  return null;
}

export type Channel = { code: string; label: string };

/** "Sold online · Shopee · order 2411ABC" / "Sample · Luzon Beauty Supply" / "Other: lost in the delivery van". */
export function purposeSentence(t: { purpose: string; channel?: string | null; platformOrderRef?: string | null; customerName?: string | null; recipientName?: string | null; note?: string | null }, channels: readonly Channel[] = []): string {
  const p = isPurpose(t.purpose) ? t.purpose : "other";
  const parts: string[] = [];
  if (p === "sold_online") {
    parts.push(PURPOSE_WORDS.sold_online.label);
    if (t.channel) parts.push(channels.find((c) => c.code === t.channel)?.label ?? t.channel.replace(/_/g, " "));
    if (t.platformOrderRef) parts.push(`order ${t.platformOrderRef}`);
  } else if (p === "customer_sample") {
    parts.push(`Sample${t.customerName || t.recipientName ? ` for ${t.customerName ?? t.recipientName}` : ""}`);
  } else if (p === "other") {
    return `Other: ${t.note?.trim() || "no note"}`;
  } else parts.push(PURPOSE_WORDS[p].label);
  return parts.join(" · ");
}

/** The `reason` written on the stock movement (shown on the stock card): "Take-out TKO-26-000001: Sold online · Shopee". */
export function movementReason(number: string, sentence: string): string {
  return `Take-out ${number}: ${sentence}`.slice(0, 500);
}

/** Whole pieces only (ADR-138: "how many pieces, whole units of the product's unit"). */
export function parsePieces(v: unknown): Decimal | null {
  const s = String(v ?? "").trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const d = new Decimal(s);
  return d.gt(0) ? d : null;
}

export type SourceCandidate = {
  lotId: string;
  locationId: string;
  containerId: string | null;
  /** open | sealed | null (loose). */
  boxStatus: string | null;
  shopShelf: boolean;
  expiresOn: string | null;
  lotNumber: string;
  free: Decimal.Value;
};

/**
 * Where to take from (ADR-138 §2): the online shop shelf first, then an already-open box or loose pieces, then the
 * earliest expiry (FEFO; lots without an expiry last), then the lot number. Candidates with nothing free are dropped.
 */
export function orderSources<T extends SourceCandidate>(c: readonly T[]): T[] {
  const rank = (x: T) => (x.boxStatus === "sealed" ? 1 : 0);
  return c
    .filter((x) => new Decimal(x.free).gt(0))
    .slice()
    .sort((a, b) => Number(b.shopShelf) - Number(a.shopShelf) || rank(a) - rank(b) || (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31") || a.lotNumber.localeCompare(b.lotNumber));
}

/** Days since a moment, in whole Manila days (0 = today). */
export function daysSince(at: Date | null, now: Date = new Date()): number | null {
  if (!at) return null;
  const day = (d: Date) => new Date(d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) + "T00:00:00Z").getTime();
  return Math.round((day(now) - day(at)) / 86_400_000);
}
