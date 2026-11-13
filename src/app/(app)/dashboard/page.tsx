import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { codeLast } from "@/lib/code-last";
import { plainDatesIn } from "@/lib/plain-date";
import { fmtDateTime } from "@/lib/qty";
import { lotsToPutAway, type PutAwayTask } from "@/modules/inventory";
import { listMyNotifications } from "@/modules/platform";
import { checksWaitingForMe, getOperatorHome, getPlannerNext, getWorkFlowCounts, type CheckItem } from "@/modules/analytics";
import { customerOrdersShort, myFloorTasks, type ShortCustomerLine } from "@/modules/production";
import { listReorderSuggestions } from "@/modules/procurement";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { homeIntro } from "@/ui/role-names";
import { homeHref, isFloor, navPersona } from "../nav";
import { OperatorHome, TasksToday } from "./operator-home";
import { PaperPackPrefetch } from "@/ui/paper-pack";
import { OwnerHomePage } from "./owner-home";
import { PROCUREMENT_LINES, WAREHOUSE_LINES, WorkList } from "./work-list";
import { putAwaySentence } from "./home-next";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  // ADR-084: the production TV account (Floor display role only) has the floor screen as its home.
  if (homeHref(ctx.roleCodes) !== "/dashboard") redirect(homeHref(ctx.roleCodes));

  // Operators (no analytics.dashboard.view) get a task home instead of the analytics overview.
  if (!ctx.can("analytics.dashboard.view")) {
    // UX review "Your tasks today": one card per batch the operator can act on (with or without an order), then quick actions.
    const floor = ctx.can("production.batch.view") && (ctx.can("production.dispense_record.create") || ctx.can("production.daily_log.create"));
    const planner = ctx.can("production.work_order.create");
    // ADR-110 C11/C13: buyers and the warehouse get their work list on Home (the "How work flows" counts).
    const buyer = ctx.can("procurement.purchase_order.create");
    const warehouse = ctx.can("inventory.movement.post") && ctx.can("sales.pick.view");
    // Live check 2026-11-06: the warehouse Home names the next lot to put away and its shelf.
    const putAwayFirst = warehouse && ctx.can("inventory.lot.view");
    // Round 5 (ADR-129): floor people read no intro and no number tiles; the checks waiting for them come right after
    // the next job (A report #11, B13); purchasing's Home starts with what to buy (C report #5).
    const floorPerson = isFloor(navPersona((p) => ctx.can(p), ctx.roleCodes));
    const buyWhat = buyer && ctx.can("procurement.reorder_suggestion.view");
    const [tiles, tasks, plan, buying, dispatch, short, putAway, messages, boxChecks, toBuy] = await Promise.all([
      getOperatorHome(ctx),
      floor ? myFloorTasks(ctx) : Promise.resolve([]),
      planner ? getPlannerNext(ctx) : Promise.resolve(null),
      buyer ? getWorkFlowCounts(ctx, PROCUREMENT_LINES.map((l) => l.key)) : Promise.resolve([]),
      warehouse ? getWorkFlowCounts(ctx, WAREHOUSE_LINES.map((l) => l.key)) : Promise.resolve([]),
      // ADR-110 C4: customer orders short of stock, for the planner.
      planner ? customerOrdersShort(ctx) : Promise.resolve([] as ShortCustomerLine[]),
      putAwayFirst ? lotsToPutAway(ctx, { limit: 50 }).catch(() => [] as PutAwayTask[]) : Promise.resolve([] as PutAwayTask[]),
      // The operator's desktop side panel: the newest open messages (the person's own; no permission needed).
      floor ? listMyNotifications(ctx).then((r) => r.slice(0, 4)).catch(() => []) : Promise.resolve([]),
      // Box checks for the warehouse (the batch checks are already floor tasks).
      warehouse && !floor ? checksWaitingForMe(ctx).catch(() => [] as CheckItem[]) : Promise.resolve([] as CheckItem[]),
      buyWhat ? listReorderSuggestions(ctx, { status: "open" }).then((r) => r.length).catch(() => 0) : Promise.resolve(0),
    ]);
    return (
      <>
        <PageHeader title={`Good day, ${ctx.displayName.split(" ")[0]}`} subtitle={ctx.currentSite.name} />
        {!floorPerson && <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>}
        {short.length > 0 && <CustomerOrdersShort lines={short} />}
        {plan && <PlannerNext plan={plan} canApprove={ctx.can("production.work_order.approve")} />}
        {buyer && <BuyerNext counts={buying} toBuy={toBuy} />}
        {putAway.length > 0 ? <PutAwayNext tasks={putAway} /> : warehouse && <WarehouseNext counts={dispatch} canCheck={boxChecks.length > 0} />}
        {boxChecks.length > 0 && <BoxChecks checks={boxChecks} />}
        {buyer && <WorkList title="Your buying work" lines={PROCUREMENT_LINES} counts={buying} testId="procurement-work" />}
        {warehouse && <WorkList title="Orders to send out" lines={WAREHOUSE_LINES} counts={dispatch} testId="warehouse-work" />}
        {floor && ctx.can("production.batch.view") && ctx.can("documents.generated_document.view") && <PaperPackPrefetch userId={ctx.userId} />}
        {floor ? (
          <TasksToday
            tasks={tasks}
            messages={messages.map((m) => ({ id: m.id, title: codeLast(plainDatesIn(m.title)).text, codes: codeLast(m.title).codes.join(" · "), at: m.createdAt }))}
          />
        ) : (
          <>
            {warehouse && <h2 className="mb-2.5 mt-2 text-[16px] font-semibold text-fg">Other jobs</h2>}
            <OperatorHome tiles={tiles} siteLabel={ctx.currentSite.code} updated={fmtDateTime(new Date())} />
          </>
        )}
      </>
    );
  }

  // ADR-083: Home answers "what needs me, how are we doing, what is happening" — nothing else (mockup
  // panel 1; owner-home.tsx). The detailed overview is under Money › Reports.
  return <OwnerHomePage ctx={ctx} scope={sp.scope} />;
}

/** ADR-110 C4: customer orders that are short of stock, each with "Make it" (the new production order, pre-filled and linked). */
function CustomerOrdersShort({ lines }: { lines: ShortCustomerLine[] }) {
  return (
    <Card className="mb-4">
      <CardTitle>Customer orders short</CardTitle>
      <ul className="flex flex-col divide-y divide-line">
        {lines.map((l) => (
          <li key={l.salesOrderLineId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0 text-[14px]">
              <p className="font-medium">
                {l.productName}: {Number(l.missing).toLocaleString("en-PH")} short
              </p>
              <p className="text-fg-2">
                For {l.salesOrderNumber} ({l.customerName}){l.neededBy ? ` · needed by ${l.neededBy}` : ""}
                {l.asked ? " · sales asked you" : ""}
              </p>
            </div>
            <LinkButton href={`/production/orders/new?salesOrderLine=${l.salesOrderLineId}`} variant="cta">
              Make it
            </LinkButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The planner's one next step (UX audit 2026-10-31): orders waiting for approval, else approved orders not started, else make a new one. */
function PlannerNext({ plan, canApprove }: { plan: { toApprove: number; approvedNotStarted: number }; canApprove: boolean }) {
  const orders = (n: number) => `${n} production order${n === 1 ? "" : "s"}`;
  if (plan.toApprove > 0)
    return canApprove ? (
      <NextStep text={`Next: ${orders(plan.toApprove)} wait for approval.`} action={{ label: "Open To approve", href: "/approvals" }} />
    ) : (
      <NextStep text={`${orders(plan.toApprove)} wait for approval.`} action={{ label: "See the orders", href: "/production/orders" }} waitingFor="Waiting for the site manager or the owner to approve." />
    );
  if (plan.approvedNotStarted > 0) return <NextStep text={`Next: ${orders(plan.approvedNotStarted)} are approved but not started. Check that materials are ready.`} action={{ label: "See the orders", href: "/production/orders" }} />;
  return <NextStep text="Nothing waits for you. Plan the next production order when stock runs low." action={{ label: "New production order", href: "/production/orders/new" }} />;
}

/** Live check 2026-11-06: the warehouse's next put-away by name (oldest released lot first), not only a count. */
function PutAwayNext({ tasks }: { tasks: PutAwayTask[] }) {
  const lots = [...new Map(tasks.map((t) => [t.lotId, t])).values()];
  const more = lots.length - 1;
  return (
    <NextStep
      text={putAwaySentence(lots[0])}
      action={{ label: "Put it away", href: "/inventory/receive/put-away" }}
      waitingFor={more > 0 ? `${more} more ${more === 1 ? "lot waits" : "lots wait"} after this one.` : undefined}
    />
  );
}

/**
 * Round 5 (A report task 3): the warehouse's ONE next job when nothing waits to be put away: the first line of "Orders
 * to send out" with work in it. A box check counts only when someone else took the boxes (the person who took them may
 * not check them).
 */
function WarehouseNext({ counts, canCheck }: { counts: { key: string; count: number }[]; canCheck: boolean }) {
  const line = WAREHOUSE_LINES.find((l) => (counts.find((c) => c.key === l.key)?.count ?? 0) > 0 && (l.key !== "shipments_to_check" || canCheck));
  if (!line) return <NextStep text="Nothing waits for you right now. New deliveries and orders show here." />;
  const n = counts.find((c) => c.key === line.key)!.count;
  return <NextStep text={`Next: ${line.title.toLowerCase()} (${n}).`} action={{ label: line.button, href: line.href }} />;
}

/** Round 5: "Waiting for you to check" on the warehouse Home (box checks of deliveries someone else took off the shelf). */
function BoxChecks({ checks }: { checks: CheckItem[] }) {
  return (
    <Card className="mb-4" data-testid="home-checks">
      <CardTitle>Waiting for you to check</CardTitle>
      <ul className="flex flex-col divide-y divide-line">
        {checks.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 text-[14px]">
              <span className="block font-medium">{c.text}</span>
              <span className="block text-fg-2">{c.detail}</span>
            </span>
            <LinkButton href={c.href} variant="secondary">{c.button}</LinkButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** ADR-110 C11 and round 5 (C report #5): what to buy first, then approved requests to order, then orders to send. */
function BuyerNext({ counts, toBuy = 0 }: { counts: { key: string; count: number }[]; toBuy?: number }) {
  const n = (k: string) => counts.find((c) => c.key === k)?.count ?? 0;
  if (toBuy > 0)
    return <NextStep text={`Next: ${toBuy === 1 ? "1 item is" : `${toBuy} items are`} running low. Ask to buy ${toBuy === 1 ? "it" : "them"}.`} action={{ label: "See what to buy", href: "/procurement/reorder" }} />;
  if (n("pr_to_order") > 0)
    return <NextStep text={`Next: ${n("pr_to_order") === 1 ? "1 approved request waits" : `${n("pr_to_order")} approved requests wait`} to be ordered from the supplier.`} action={{ label: "Make the purchase orders", href: "/procurement/requests?status=approved" }} />;
  if (n("po_to_send") > 0)
    return <NextStep text={`Next: ${n("po_to_send") === 1 ? "1 purchase order is" : `${n("po_to_send")} purchase orders are`} approved. Send ${n("po_to_send") === 1 ? "it" : "them"} to the supplier.`} action={{ label: "Send them", href: "/procurement/orders?status=approved" }} />;
  return <NextStep text="Nothing waits for you. Ask to buy something when stock runs low." action={{ label: "Ask to buy something", href: "/procurement/requests/new" }} />;
}
