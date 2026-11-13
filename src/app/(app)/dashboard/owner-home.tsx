import Link from "next/link";
import Decimal from "decimal.js";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, PhilippinePeso, Plus, Truck, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { fmtDate } from "@/lib/qty";
import { checksWaitingForMe, getOperationsCenter, needsMeBreakdown, getOwnerHome, getWorkFlowCounts, type CheckItem } from "@/modules/analytics";
import { myApprovalCount } from "@/modules/action-centre";
import { notInvoicedShipments, payablesSummary, receivablesSummary } from "@/modules/finance";
import { nextActors } from "@/modules/governance";
import { getQaQueue } from "@/modules/quality";
import { orderCounts } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { homeIntro } from "@/ui/role-names";
import { navPersona } from "../nav";
import { needsMeFor } from "../needs-me";
import { RecentActivity, SalesWeek, attentionItems, type AttentionItem } from "./simple-home";
import { firstActionable, salesItems } from "./home-next";
import { businessActivity } from "./activity-sentence";

/** Whole pesos for the big card number (the drill-down shows centavos). */
const peso = (v: string | null | undefined) => `₱${new Decimal(v ?? 0).toDecimalPlaces(0).toNumber().toLocaleString("en-PH")}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

/**
 * Who does each line that is not the viewer's job (round 5, ADR-129; B report #5: "Next: 1 finished batch waits for
 * the QA check" on the owner's Home, without saying that Nina does it). The permission the deciding service checks,
 * the job's roles (HandoffRule.only) and the words. Pages and services still check every permission.
 */
const OTHERS: Record<string, { permission: Permission; does: (n: number) => string; only?: string[]; prefer?: string[] }> = {
  qc: { permission: "quality.disposition.approve", does: (n) => `checks ${plural(n, "finished batch", "finished batches")}`, only: ["qa_qc"], prefer: ["qa_qc"] },
  hold: { permission: "quality.disposition.approve", does: (n) => `decides on ${plural(n, "lot", "lots")} stopped by QA`, only: ["qa_qc"], prefer: ["qa_qc"] },
  expiring: { permission: "inventory.movement.post", does: (n) => `uses up or sets aside ${plural(n, "lot that expires", "lots that expire")} soon`, only: ["warehouse_operator"], prefer: ["warehouse_operator"] },
  low: { permission: "procurement.purchase_request.create", does: (n) => `orders ${plural(n, "item that is", "items that are")} low`, only: ["procurement"], prefer: ["procurement"] },
  expected: { permission: "procurement.purchase_order.create", does: (n) => `follows up ${plural(n, "late supplier delivery", "late supplier deliveries")}`, only: ["procurement"], prefer: ["procurement"] },
  dispatch: { permission: "sales.shipment.post", does: (n) => `sends out ${plural(n, "late customer order", "late customer orders")}`, only: ["warehouse_operator"], prefer: ["warehouse_operator"] },
  production: { permission: "production.work_order.create", does: (n) => `starts ${plural(n, "late batch", "late batches")}`, only: ["production_planner", "site_manager"], prefer: ["production_planner"] },
  invoice: { permission: "finance.invoice.create", does: (n) => `bills ${plural(n, "delivery", "deliveries")}`, only: ["finance"], prefer: ["finance"] },
  invoice_wait: { permission: "finance.invoice.approve", does: (n) => `approves ${plural(n, "invoice", "invoices")}`, prefer: ["finance", "owner_director"] },
  invoice_save: { permission: "finance.invoice.post", does: (n) => `saves ${plural(n, "invoice", "invoices")} to the books`, only: ["finance"], prefer: ["finance"] },
};
/** Lines that warn about stock rather than wait on a person's step. */
const WATCH_OUT = new Set(["low", "expiring", "hold"]);

type OtherLine = { item: AttentionItem; who: string | null; mine: boolean };

/** "Nina (QA)" or "Nina (QA) or Teresa (QA)"; null when nobody else can do it. */
async function whoDoes(ctx: AuthContext, key: string, n: number): Promise<{ who: string | null; does: string; viewerCan: boolean } | null> {
  const r = OTHERS[key];
  if (!r) return null;
  const next = await nextActors(ctx, { kind: `home.${key}`, permission: r.permission, does: r.does(n), doBase: r.does(n), where: "", fallback: "", independent: true, only: r.only, prefer: r.prefer }, { siteId: ctx.currentSiteId }).catch(() => null);
  const people = next?.people ?? [];
  const names = people.slice(0, 2).map((p) => `${p.name.split(/\s+/)[0]} (${p.role})`);
  return { who: names.length ? names.join(" or ") + (people.length > 2 ? ` or ${people.length - 2} more` : "") : null, does: r.does(n), viewerCan: !!next?.viewer.can };
}

/** Splits the attention lines into the viewer's own work and the work of others, each with who does it. */
async function sortOut(ctx: AuthContext, items: AttentionItem[]): Promise<OtherLine[]> {
  const out: OtherLine[] = [];
  for (const item of items) {
    if (item.key === "approve") continue; // the viewer's own approvals are the "Needs you" card and the next step
    const n = Number(item.text.match(/^[\d,]+/)?.[0]?.replace(/,/g, "") ?? 1);
    const w = await whoDoes(ctx, item.key, n);
    // Nobody else does it and the viewer may: it is the viewer's job.
    out.push({ item, who: w?.who ? `${w.who} ${w.does}` : null, mine: !!w && !w.who && w.viewerCan });
  }
  return out;
}

/** One white card with a big number; amber only when it asks for action (never red for a zero). */
function MoneyCard({ title, icon, value, href, children, tone = "neutral", testId }: { title: string; icon: ReactNode; value: ReactNode; href: string; children?: ReactNode; tone?: "neutral" | "attention"; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className={cx("group flex h-full min-w-0 flex-col rounded-[18px] border p-3.5 transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-4", tone === "attention" ? "border-[var(--warn-bd)] bg-[var(--warn-bg)]" : "border-line bg-surface")}>
      <span className="flex items-center gap-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-2" aria-hidden>{icon}</span>
        <span className="min-w-0 text-[13px] font-semibold leading-tight text-fg">{title}</span>
      </span>
      <span className="mt-3 block break-words font-display text-stat leading-none text-fg tabular">{value}</span>
      {children && <span className="mt-2 block text-[12.5px] leading-snug text-fg-2">{children}</span>}
    </Link>
  );
}

function ChecksForMe({ checks }: { checks: CheckItem[] }) {
  if (!checks.length) return null;
  return (
    <section aria-labelledby="checks-h" className="rounded-[20px] border border-[var(--warn-bd)] bg-surface p-4 sm:p-5" data-testid="home-checks">
      <h2 id="checks-h" className="font-display text-section font-semibold text-fg">Waiting for you to check</h2>
      <ul className="mt-1 divide-y divide-line">
        {checks.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-fg">{c.text}</span>
              <span className="block text-[13px] text-fg-2">{c.detail}</span>
            </span>
            <LinkButton href={c.href} variant="secondary">{c.button}</LinkButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LineList({ title, lines, testId, icon }: { title: string; lines: OtherLine[]; testId: string; icon: ReactNode }) {
  if (!lines.length) return null;
  return (
    <section aria-labelledby={`${testId}-h`} className="rounded-[20px] border border-line bg-surface p-4 sm:p-5" data-testid={testId}>
      <h2 id={`${testId}-h`} className="font-display text-section font-semibold text-fg">{title}</h2>
      <ul className="mt-1 divide-y divide-line">
        {lines.map(({ item, who }) => (
          <li key={item.key}>
            <Link href={item.href} className="group flex min-h-[48px] items-center gap-3 py-2 text-[15px] text-fg">
              <span className="shrink-0 text-fg-2" aria-hidden>{icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block">{item.text}</span>
                {who && <span className="block text-[13px] text-fg-2">{who}</span>}
              </span>
              <ArrowRight size={16} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const greetingOf = () => {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};

/**
 * Home for the owner, the site manager and the office roles that read the numbers (round 5, ADR-129; B report #4, #5,
 * #14; C report #12). Owner and manager: what needs you and the money first — "What to do next" is only the viewer's
 * own job (approvals, checks waiting for them), never another person's green button; the four cards Sales this month,
 * Customers owe us, We owe suppliers, Needs you (a zero is not red); "Waiting for you to check"; the work of others
 * with names ("Nina (QA) checks 1 finished batch"); "Watch out"; sales this week; recent activity in plain words.
 * Sales and QA get their own Home (below). Every number is computed on the server for the caller's sites.
 */
export async function OwnerHomePage({ ctx, scope }: { ctx: AuthContext; scope?: string }) {
  const persona = navPersona((p) => ctx.can(p), ctx.roleCodes);
  if (persona === "qa") return <QaHome ctx={ctx} />;
  const all = scope === "all" && ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view");
  let home;
  try {
    home = await getOwnerHome(ctx, { all });
  } catch (e) {
    if (e instanceof DomainError && (e.code === "forbidden" || e.code === "not_found"))
      return (
        <>
          <PageHeader title="Home" />
          <EmptyState title="This view isn't available to you" action={<Link href="/dashboard" className="font-medium text-primary-text hover:underline">Open your site&apos;s home</Link>}>
            {e.message}
          </EmptyState>
        </>
      );
    throw e;
  }
  const salesDesk = persona === "sales" && ctx.can("sales.sales_order.view") && !all;
  const [oc, needs, unbilled, soCounts, soFlow, rec, pay] = await Promise.all([
    getOperationsCenter(ctx, { all }),
    needsMeFor(ctx),
    ctx.can("finance.invoice.view") ? notInvoicedShipments(ctx).catch(() => null) : Promise.resolve(null),
    salesDesk ? orderCounts(ctx).catch(() => null) : Promise.resolve(null),
    salesDesk ? getWorkFlowCounts(ctx, ["so_short", "so_can_set_aside"]).catch(() => []) : Promise.resolve([]),
    ctx.can("finance.invoice.view") && persona !== "sales" ? receivablesSummary(ctx).catch(() => null) : Promise.resolve(null),
    ctx.can("finance.supplier_bill.view") ? payablesSummary(ctx).catch(() => null) : Promise.resolve(null),
  ]);
  const approvals = needs.approvals;
  const checks = needs.checkItems;
  const notBilled = unbilled ? { count: unbilled.count, toMake: unbilled.toMake, waitingApproval: unbilled.waitingApproval, toSave: unbilled.toSave, oldestDays: unbilled.oldestDispatchedAt ? Math.floor((Date.now() - unbilled.oldestDispatchedAt.getTime()) / 86_400_000) : null } : null;
  const qs = all ? "?scope=all" : "";
  const stockHref = `/dashboard/details/stock${qs}`;
  const greeting = greetingOf();
  const today = new Date(home.today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const pill = (href: string, active: boolean, label: string) => (
    <Link key={label} href={href} aria-current={active ? "page" : undefined} className={cx("flex min-h-[44px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium", active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2")}>
      {label}
    </Link>
  );
  const header = (
    <PageHeader
      title={`${greeting}, ${ctx.displayName.split(" ")[0]}`}
      subtitle={`${today} · ${all ? "All your sites" : ctx.currentSite.name}`}
      actions={
        ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view") ? (
          <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Sites">
            {pill("/dashboard", !all, "This site")}
            {pill("/dashboard?scope=all", all, "All my sites")}
          </div>
        ) : undefined
      }
    />
  );
  const activity = home.activity ? businessActivity(home.activity, 5) : null;

  // ---------------------------------------------------------------- sales (C report: Home "Sales")
  if (persona === "sales") {
    const flowN = (k: string) => soFlow.find((c) => c.key === k)?.count ?? 0;
    const sales = soCounts ? salesItems({ toConfirm: (soCounts.draft ?? 0) + (soCounts.submitted ?? 0), short: flowN("so_short"), canSetAside: flowN("so_can_set_aside") }) : [];
    const next = firstActionable(sales, (p) => ctx.can(p as Permission));
    const s = home.salesToday;
    const m = home.salesMonth;
    return (
      <div className="space-y-5">
        {header}
        <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>
        {next ? <NextStep text={`Next: ${next.text}.`} action={{ label: next.key === "so_confirm" ? "Open the orders" : "See the orders", href: next.href }} /> : <NextStep text="Nothing waits for you right now." />}
        <div className="flex flex-wrap gap-2">
          {ctx.can("sales.sales_order.create") && <LinkButton href="/sales/new" variant="cta"><Plus size={16} aria-hidden /> New customer order</LinkButton>}
          {ctx.can("sales.quote.create") && <LinkButton href="/sales/quotations/new" variant="secondary"><Plus size={16} aria-hidden /> New price offer</LinkButton>}
        </div>
        <section aria-label="Sales at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {s && <MoneyCard title="Sales today" icon={<PhilippinePeso size={16} />} href={s.href} value={s.masked ? plural(s.orders, "order", "orders") : peso(s.value)}>{plural(s.orders, "order", "orders")} confirmed today</MoneyCard>}
          {m && <MoneyCard title="Sales this month" icon={<PhilippinePeso size={16} />} href={m.href} value={m.masked ? plural(m.orders, "order", "orders") : peso(m.value)} testId="card-sales-month">{plural(m.orders, "order", "orders")} confirmed this month</MoneyCard>}
        </section>
        {sales.filter((i) => i !== next).length > 0 && <LineList title="Your orders" testId="home-sales-work" icon={<AlertTriangle size={18} />} lines={sales.filter((i) => i !== next).map((item) => ({ item, who: null, mine: true }))} />}
        {home.salesWeek && <SalesWeek week={home.salesWeek} scopeLabel={home.scope.label} generatedAt={home.generatedAt} />}
        {activity && activity.length > 0 && <RecentActivity rows={activity} showSite={all} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- owner, site manager and the others
  const items = attentionItems(oc, approvals, home.stock, stockHref, notBilled);
  const lines = await sortOut(ctx, items);
  const mine = lines.filter((l) => l.mine);
  const others = lines.filter((l) => !l.mine && !WATCH_OUT.has(l.item.key));
  const watch = lines.filter((l) => !l.mine && WATCH_OUT.has(l.item.key));
  // ADR-132 §1: the same number as the "Needs me" badge (approvals + checks + messages that ask you to act).
  const needsYou = needs.total;
  const waitingSummary = others.filter((l) => l.who).slice(0, 2).map((l) => l.who!);
  const next =
    approvals > 0
      ? <NextStep text={`Next: ${plural(approvals, "thing waits", "things wait")} for your decision.`} action={{ label: "Open To approve", href: "/approvals" }} />
      : checks.length > 0
        ? <NextStep text={`Next: ${checks[0].text.charAt(0).toLowerCase()}${checks[0].text.slice(1)}.`} action={{ label: checks[0].button, href: checks[0].href }} />
        : needs.messages > 0
          ? <NextStep text={`Next: ${plural(needs.messages, "message asks", "messages ask")} you to do something.`} action={{ label: "Open messages", href: "/notifications" }} />
          : mine.length > 0
            ? <NextStep text={`Next: ${mine[0].item.text}.`} action={{ label: "Open it", href: mine[0].item.href }} />
            : <NextStep text="Nothing needs you now." waitingFor={waitingSummary.length ? `Waiting on others: ${waitingSummary.join(" · ")}.` : undefined} />;
  const sm = home.salesMonth;
  return (
    <div className="space-y-5">
      {header}
      <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>
      {next}
      <section aria-label="Money and what needs you" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="home-cards">
        {sm && (
          <MoneyCard title="Sales this month" icon={<PhilippinePeso size={16} />} href={sm.href} value={sm.masked ? plural(sm.orders, "order", "orders") : peso(sm.value)} testId="card-sales-month">
            {plural(sm.orders, "order", "orders")} confirmed{!sm.masked && home.salesToday?.value && Number(home.salesToday.value) > 0 ? ` · today ${peso(home.salesToday.value)}` : ""}
          </MoneyCard>
        )}
        {rec && (
          <MoneyCard title="Customers owe us" icon={<Users size={16} />} href="/finance/statements" value={peso(rec.outstanding)} testId="card-owed-to-us">
            {Number(rec.overdue) > 0 ? `${peso(rec.overdue)} of it is late` : "Nothing late"}
          </MoneyCard>
        )}
        {pay && (
          <MoneyCard title="We owe suppliers" icon={<Truck size={16} />} href="/finance/bills" value={peso(pay.outstanding)} testId="card-we-owe">
            {Number(pay.overdue) > 0 ? `${peso(pay.overdue)} of it is late` : pay.openCount ? plural(pay.openCount, "bill to pay", "bills to pay") : "No bills to pay"}
          </MoneyCard>
        )}
        <MoneyCard title="Needs you" icon={<ClipboardCheck size={16} />} href={needs.href} value={needsYou.toLocaleString("en-PH")} tone={needsYou > 0 ? "attention" : "neutral"} testId="card-needs-you">
          {needsYou === 0 ? (
            <span className="inline-flex items-center gap-1"><CheckCircle2 size={14} aria-hidden /> Nothing to decide</span>
          ) : (
            needsMeBreakdown(needs)
          )}
        </MoneyCard>
      </section>
      <ChecksForMe checks={checks} />
      <LineList title="Also yours" testId="home-mine" icon={<ArrowRight size={18} />} lines={mine} />
      {(others.length > 0 || watch.length > 0 || home.salesWeek) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <LineList title="Waiting on others" testId="home-others" icon={<ArrowRight size={18} />} lines={others} />
            <LineList title="Watch out" testId="home-watch" icon={<AlertTriangle size={18} />} lines={watch} />
          </div>
          {home.salesWeek && <SalesWeek week={home.salesWeek} scopeLabel={home.scope.label} generatedAt={home.generatedAt} />}
        </div>
      )}
      {activity && <RecentActivity rows={activity} showSite={all} />}
      <p className="text-[14px] text-fg-2">
        More numbers and charts:{" "}
        <Link href={all ? "/analytics?scope=all" : "/analytics"} className="inline-flex min-h-[44px] items-center font-medium text-primary-text underline">
          Reports
        </Link>
        {" · "}
        <Link href="/operations" className="inline-flex min-h-[44px] items-center font-medium text-primary-text underline">
          Operations Center
        </Link>
      </p>
    </div>
  );
}

/**
 * QA Home (C report, QA): the green button is the oldest item to check (a finished batch or a delivered lot), then the
 * rest of the queue, what QA stopped and what waits for a QA approval. No sales numbers.
 */
async function QaHome({ ctx }: { ctx: AuthContext }) {
  const [queue, approvals, checks] = await Promise.all([
    ctx.can("quality.disposition.view") ? getQaQueue(ctx).catch(() => null) : Promise.resolve(null),
    myApprovalCount(ctx).catch(() => 0),
    checksWaitingForMe(ctx).catch(() => [] as CheckItem[]),
  ]);
  type Row = { key: string; text: string; detail: string; href: string; at: number; button: string };
  const rows: Row[] = [
    ...(queue?.batches ?? []).map((b) => ({ key: `b${b.id}`, text: `Batch of ${b.productName}`, detail: `Batch ${b.batchNumber}${b.completedAt ? ` · finished ${fmtDate(b.completedAt)}` : ""}`, href: `/quality/check/${b.id}`, at: b.completedAt ? new Date(b.completedAt).getTime() : 0, button: "Check this batch" })),
    ...(queue?.lots ?? []).map((l) => ({ key: `l${l.id}`, text: `${l.itemName}${l.supplierName ? ` from ${l.supplierName}` : ""}`, detail: `Lot ${l.lotNumber} · delivered ${fmtDate(l.receivedAt)}`, href: `/quality/lots/${l.id}`, at: new Date(l.receivedAt).getTime(), button: "Check this delivery" })),
  ].sort((a, b) => a.at - b.at);
  const canDecide = ctx.can("quality.disposition.approve");
  const first = rows[0];
  const greeting = greetingOf();
  return (
    <div className="space-y-5">
      <PageHeader title={`${greeting}, ${ctx.displayName.split(" ")[0]}`} subtitle={ctx.currentSite.name} />
      <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>
      {first ? (
        <NextStep text={`Next: check the oldest one, ${first.text.charAt(0).toLowerCase()}${first.text.slice(1)} (${first.detail}).`} action={canDecide ? { label: first.button, href: first.href } : undefined} waitingFor={canDecide ? undefined : "Waiting for a QA person to check it."} />
      ) : approvals > 0 ? (
        <NextStep text={`Next: ${plural(approvals, "thing waits", "things wait")} for your decision.`} action={{ label: "Open To approve", href: "/approvals" }} />
      ) : (
        <NextStep text="Nothing waits for your check right now." />
      )}
      <section aria-label="Quality at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="home-cards">
        <MoneyCard title="Waiting for your check" icon={<ClipboardCheck size={16} />} href="/quality" value={rows.length} tone={rows.length ? "attention" : "neutral"}>
          {rows.length ? `${plural(queue?.batches.length ?? 0, "batch", "batches")} · ${plural(queue?.lots.length ?? 0, "delivery", "deliveries")}` : "Nothing waits"}
        </MoneyCard>
        <MoneyCard title="To approve" icon={<CheckCircle2 size={16} />} href="/approvals" value={approvals} tone={approvals ? "attention" : "neutral"}>
          {approvals ? "Needs your decision" : "Nothing to decide"}
        </MoneyCard>
      </section>
      <ChecksForMe checks={checks} />
      {rows.length > 1 && (
        <section aria-labelledby="qa-rest-h" className="rounded-[20px] border border-line bg-surface p-4 sm:p-5">
          <h2 id="qa-rest-h" className="font-display text-section font-semibold text-fg">After that</h2>
          <ul className="mt-1 divide-y divide-line">
            {rows.slice(1, 8).map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="group flex min-h-[48px] items-center gap-3 py-2 text-[15px] text-fg">
                  <span className="min-w-0 flex-1">
                    <span className="block">{r.text}</span>
                    <span className="block text-[13px] text-fg-2">{r.detail}</span>
                  </span>
                  <ArrowRight size={16} className="shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {rows.length > 8 && (
            <Link href="/quality" className="mt-1 inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">
              See all {rows.length}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
