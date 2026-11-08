import Decimal from "decimal.js";

/**
 * ONE rule for "is this customer order short?" (live check 2026-11-06, finding 1), shared by the "How work flows"
 * page (stages 7, 8 and 11), the planner's Home ("Customer orders short") and the shortage card on the customer
 * order. Pure (no I/O) so it is unit tested (tests/unit/order-cover-rule.test.ts); the loader is order-cover.ts.
 *
 * Orders are served one after the other in their priority order (earliest delivery date first):
 *
 * 1. Free stock (the set-aside rule, ADR-110 C2). An order whose every line is covered by the free stock left takes
 *    it: "can now be set aside". An order that is not fully covered takes nothing from the free stock (it cannot be
 *    set aside yet), but the free stock it could use is shown and counted against its shortage.
 * 2. Stock that is coming, closest first: batches waiting for the QA check (their lot in the QA waiting area), then
 *    batches of approved or in-progress production orders, then (only for the order they were made for) production
 *    orders still waiting for approval. A source made for this order (work_orders.sales_order_id) is used first;
 *    then sources made for no open order, shared out in priority order. A source promised to another open order is
 *    never counted for this one.
 * 3. What is still missing after 1 and 2 "needs making". An order covered by 1 + 2 but not by 1 alone is "coming".
 */

export type CoverLine = { lineId: string; productId: string; /** Ordered − set aside (never below 0). */ need: Decimal.Value };
export type CoverOrder = { orderId: string; lines: CoverLine[] };

export type ComingKind = "waiting_qa" | "being_made" | "planned";
export type ComingSource = {
  /** Batch or production order id (each source is used once across all orders). */
  id: string;
  ref: string;
  productId: string;
  kind: ComingKind;
  qty: Decimal.Value;
  /** The customer order the production order was made for; null = for stock. */
  salesOrderId: string | null;
  /** ADR-131: the day the pieces are expected to be usable (planned finish or today, plus the QA days); null = not known. */
  readyOn?: string | null;
};

export type ComingTaken = { sourceId: string; ref: string; kind: ComingKind; qty: Decimal; readyOn?: string | null };

export type LineCover = {
  lineId: string;
  productId: string;
  need: Decimal;
  /** Free stock counted for this line (taken when the order is fully covered; shown otherwise). */
  fromFree: Decimal;
  coming: ComingTaken[];
  comingTotal: Decimal;
  missing: Decimal;
};

export type OrderCoverState = "nothing_needed" | "can_set_aside" | "coming" | "short";
export type OrderCoverResult = { orderId: string; state: OrderCoverState; lines: LineCover[] };

const KIND_ORDER: Record<ComingKind, number> = { waiting_qa: 0, being_made: 1, planned: 2 };

export function coverOrders(orders: readonly CoverOrder[], freeStock: ReadonlyMap<string, Decimal.Value>, coming: readonly ComingSource[]): OrderCoverResult[] {
  const free = new Map<string, Decimal>([...freeStock.entries()].map(([k, v]) => [k, new Decimal(v)]));
  const openIds = new Set(orders.map((o) => o.orderId));
  // Left in each source; a source promised to an order that is not open any more is for anyone.
  const left = new Map<string, Decimal>(coming.map((c) => [c.id, Decimal.max(new Decimal(c.qty), 0)]));
  const sorted = [...coming].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.ref.localeCompare(b.ref));
  const owner = (c: ComingSource) => (c.salesOrderId && openIds.has(c.salesOrderId) ? c.salesOrderId : null);

  const out: OrderCoverResult[] = [];
  for (const o of orders) {
    const lines = o.lines.map((l) => ({ ...l, need: Decimal.max(new Decimal(l.need), 0) }));
    const needed = lines.filter((l) => l.need.gt(0));
    if (needed.length === 0) {
      out.push({ orderId: o.orderId, state: "nothing_needed", lines: lines.map((l) => ({ lineId: l.lineId, productId: l.productId, need: l.need, fromFree: new Decimal(0), coming: [], comingTotal: new Decimal(0), missing: new Decimal(0) })) });
      continue;
    }
    // Several lines of one product share the free stock.
    const byProduct = new Map<string, Decimal>();
    for (const l of needed) byProduct.set(l.productId, (byProduct.get(l.productId) ?? new Decimal(0)).plus(l.need));
    const covered = [...byProduct.entries()].every(([p, n]) => (free.get(p) ?? new Decimal(0)).gte(n));
    if (covered) {
      for (const [p, n] of byProduct) free.set(p, free.get(p)!.minus(n));
      out.push({ orderId: o.orderId, state: "can_set_aside", lines: lines.map((l) => ({ lineId: l.lineId, productId: l.productId, need: l.need, fromFree: l.need, coming: [], comingTotal: new Decimal(0), missing: new Decimal(0) })) });
      continue;
    }
    const shownFree = new Map(free); // not taken: the order cannot be set aside yet
    const result: LineCover[] = lines.map((l) => {
      const fromFree = Decimal.min(l.need, shownFree.get(l.productId) ?? 0);
      shownFree.set(l.productId, (shownFree.get(l.productId) ?? new Decimal(0)).minus(fromFree));
      let rest = l.need.minus(fromFree);
      const taken: ComingTaken[] = [];
      // Made for this order first, then for no open order; never another order's.
      for (const pass of [o.orderId, null] as const) {
        for (const c of sorted) {
          if (rest.lte(0)) break;
          if (c.productId !== l.productId || owner(c) !== pass) continue;
          const have = left.get(c.id)!;
          if (have.lte(0)) continue;
          const q = Decimal.min(have, rest);
          left.set(c.id, have.minus(q));
          rest = rest.minus(q);
          taken.push({ sourceId: c.id, ref: c.ref, kind: c.kind, qty: q, readyOn: c.readyOn ?? null });
        }
      }
      const comingTotal = taken.reduce((t, x) => t.plus(x.qty), new Decimal(0));
      return { lineId: l.lineId, productId: l.productId, need: l.need, fromFree, coming: taken, comingTotal, missing: Decimal.max(rest, 0) };
    });
    out.push({ orderId: o.orderId, state: result.some((r) => r.missing.gt(0)) ? "short" : "coming", lines: result });
  }
  return out;
}

export type CanShipFrom = { date: string | null; why: "all_set_aside" | "on_the_shelf" | "coming" | "not_known" };

/**
 * ADR-131 (C-office problem 3): "Can ship from" for one customer order, from the cover of its open lines. Everything
 * set aside or on the shelf = today; stock that is coming = the latest ready day of what it takes; anything still
 * missing (or a source with no known day) = not known. Pure.
 */
export function canShipFrom(lines: readonly Pick<LineCover, "need" | "fromFree" | "coming" | "missing">[], today: string): CanShipFrom {
  const open = lines.filter((l) => new Decimal(l.need).gt(0));
  if (open.length === 0) return { date: today, why: "all_set_aside" };
  if (open.some((l) => new Decimal(l.missing).gt(0))) return { date: null, why: "not_known" };
  const taken = open.flatMap((l) => l.coming.filter((c) => new Decimal(c.qty).gt(0)));
  if (taken.length === 0) return { date: today, why: "on_the_shelf" };
  if (taken.some((c) => !c.readyOn)) return { date: null, why: "not_known" };
  const latest = taken.map((c) => c.readyOn!).sort().at(-1)!;
  return { date: latest < today ? today : latest, why: "coming" };
}

const KIND_WORDS: Record<ComingKind, string> ={ waiting_qa: "waiting for QA", being_made: "being made", planned: "in a production order waiting for approval" };

/** "coming: 94 waiting for QA, 2 being made" (empty when nothing is coming). Whole pieces. */
export function comingWords(coming: readonly Pick<ComingTaken, "kind" | "qty">[]): string {
  const sums = new Map<ComingKind, Decimal>();
  for (const c of coming) sums.set(c.kind, (sums.get(c.kind) ?? new Decimal(0)).plus(c.qty));
  const parts = (Object.keys(KIND_ORDER) as ComingKind[]).filter((k) => sums.get(k)?.gt(0)).map((k) => `${sums.get(k)!.toDecimalPlaces(0).toNumber().toLocaleString("en-PH")} ${KIND_WORDS[k]}`);
  return parts.length ? `coming: ${parts.join(", ")}` : "";
}
