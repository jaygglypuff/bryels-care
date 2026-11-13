/**
 * Many messages of one kind become one row (round 5 leftovers, ADR-132 §2; A report #6): "12 lots are ready to put
 * away" opens the list; the row expands to show each message, which keeps its own Open / Mark read / I'm on it and
 * still clears by itself when its work is done (ADR-129 `resolveDoneNotifications`, per message).
 *
 * Messages are grouped when they are of the same kind family, point at the same screen, were sent the same day
 * (Manila time) and are in the same state (open, taken on, done). Fewer than GROUP_FROM stay single rows. Pure
 * (unit-tested); the order of the list is kept (a group sits where its newest message was).
 */
export const GROUP_FROM = 3;

type Family = { id: string; list: string; many: (n: number) => string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Kind → family: the list it opens and the sentence for many. */
const FAMILIES: Record<string, Family> = {};
function family(kinds: string[], f: Family) {
  for (const k of kinds) FAMILIES[k] = f;
}
family(["inventory.lot.ready_to_put_away"], { id: "put_away", list: "/inventory/receive/put-away", many: (n) => `${plural(n, "lot is", "lots are")} ready to put away` });
family(["quality.lots.received"], { id: "lots_received", list: "/quality", many: (n) => `${plural(n, "delivered lot waits", "delivered lots wait")} for the quality check` });
family(["handoff.batch_qa"], { id: "batch_qa", list: "/quality", many: (n) => `${plural(n, "finished batch waits", "finished batches wait")} for your QA decision` });
family(["handoff.weighing_check", "handoff.step_check", "handoff.start_check"], { id: "checks", list: "/production/checks", many: (n) => `${plural(n, "check waits", "checks wait")} for you` });
family(["handoff.pick"], { id: "pick", list: "/sales/picking", many: (n) => `${plural(n, "order", "orders")} to get from the shelf` });
family(["handoff.pack_check"], { id: "pack_check", list: "/sales/dispatch", many: (n) => `${plural(n, "delivery waits", "deliveries wait")} for the box check` });
family(["handoff.dispatch"], { id: "dispatch", list: "/sales/dispatch", many: (n) => `${plural(n, "delivery is", "deliveries are")} ready to send out` });
family(["sales_order_confirmed", "handoff.set_aside"], { id: "set_aside", list: "/sales", many: (n) => `${plural(n, "customer order is", "customer orders are")} ready to set aside` });
family(["production.order.to_approve", "handoff.production_order"], { id: "po_make", list: "/approvals", many: (n) => `${plural(n, "production order waits", "production orders wait")} for your approval` });
family(["purchase_order_submitted", "handoff.purchase_order"], { id: "po_buy", list: "/approvals", many: (n) => `${plural(n, "purchase order waits", "purchase orders wait")} for your approval` });
family(["purchase_order_approved", "handoff.purchase_order_send"], { id: "po_send", list: "/procurement/orders", many: (n) => `${plural(n, "purchase order is", "purchase orders are")} ready to send to the supplier` });
family(["handoff.delivery_coming"], { id: "coming", list: "/inventory/receive", many: (n) => `${plural(n, "supplier delivery is", "supplier deliveries are")} coming` });
family(["approval_requested"], { id: "approval", list: "/approvals", many: (n) => `${plural(n, "thing waits", "things wait")} for your approval` });

const UUID_SEG = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

/** The screen a message points at, without the record: "/production/orders/<id>" → "/production/orders". */
export function targetScreen(link: string | null): string {
  if (!link) return "";
  const path = link.split(/[?#]/)[0];
  return path.replace(UUID_SEG, "") || "/";
}

export type GroupableMessage = { id: string; kind: string; title: string; link: string | null; createdAt: Date; readAt: Date | null; acknowledgedAt: Date | null; resolvedAt: Date | null };

export type MessageRow<M extends GroupableMessage> =
  | { type: "one"; message: M }
  | { type: "group"; key: string; title: string; list: string; unread: number; messages: M[]; /** Kinds without their own sentence: the newest message's title, so the row says what it is about. */ newest: string | null };

const manilaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const stateOf = (m: GroupableMessage) => (m.resolvedAt ? "done" : m.acknowledgedAt ? "taken" : "open");

export function groupMessages<M extends GroupableMessage>(messages: readonly M[]): MessageRow<M>[] {
  const keyOf = (m: M) => {
    const f = FAMILIES[m.kind];
    return `${f ? f.id : `${m.kind}|${targetScreen(m.link)}`}|${manilaDay(m.createdAt)}|${stateOf(m)}`;
  };
  const buckets = new Map<string, M[]>();
  for (const m of messages) {
    const k = keyOf(m);
    const b = buckets.get(k);
    if (b) b.push(m);
    else buckets.set(k, [m]);
  }
  const out: MessageRow<M>[] = [];
  const placed = new Set<string>();
  for (const m of messages) {
    const k = keyOf(m);
    const b = buckets.get(k)!;
    if (b.length < GROUP_FROM) {
      out.push({ type: "one", message: m });
      continue;
    }
    if (placed.has(k)) continue;
    placed.add(k);
    const f = FAMILIES[m.kind];
    const screen = targetScreen(m.link);
    out.push({
      type: "group",
      key: k,
      title: f ? f.many(b.length) : `${b.length} messages like this`,
      list: f ? f.list : screen || "/notifications",
      unread: b.filter((x) => !x.readAt && !x.resolvedAt).length,
      messages: b,
      newest: f ? null : b[0].title,
    });
  }
  return out;
}
