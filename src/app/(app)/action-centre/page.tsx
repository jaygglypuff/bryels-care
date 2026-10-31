import Link from "next/link";
import { redirect } from "next/navigation";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ACTION_KINDS, ACTION_TABS, type ActionItemView, listActionItems, myApprovalCount, refreshActionItems } from "@/modules/action-centre";
import { listMyNotifications } from "@/modules/platform";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, buttonClass, cx } from "@/ui/core";
import { isInternalPath, recordHref } from "@/lib/record-links";
import { Banner, Chip } from "@/ui/status";
import { AcknowledgeForm } from "./forms";
import { registerAppHooks } from "@/modules/wiring";
import { SyncConflictSummary } from "../sync/conflict-summary"; // W4D (US-7-05)

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Action centre" };
export const dynamic = "force-dynamic";

const SEV = { critical: { tone: "bad", label: "Critical" }, warning: { tone: "warn", label: "Warning" }, info: { tone: "info", label: "Info" } } as const;

function age(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

type SP = { tab?: string; kind?: string; group?: string; acked?: string };

function ItemRow({ i }: { i: ActionItemView }) {
  const sev = SEV[i.severity as keyof typeof SEV] ?? SEV.info;
  return (
    <li className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={sev.tone}>{sev.label}</Chip>
          {i.escalationLevel > 0 && <Chip tone="bad">Escalated</Chip>}
          {i.acknowledgedAt && <Chip tone="neu">Someone is on it</Chip>}
          <span className="text-[12px] text-muted">{i.kindLabel} · {i.siteCode ?? "whole company"} · waiting {age(i.ageMinutes)}</span>
        </div>
        <p className="mt-1 text-[15px] font-medium text-fg">
          {i.title}
          {i.recordNumber && <span className="ml-1 font-mono text-[12px] text-muted">{i.recordNumber}</span>}
        </p>
        {i.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{i.detail}</p>}
        {i.acknowledgementNote && <p className="mt-0.5 text-[12px] text-muted">Note: {i.acknowledgementNote}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start">
        <LinkButton href={isInternalPath(i.link) ? i.link : (recordHref(i.entityType, i.entityId) ?? "/action-centre")} size="sm">{i.actionLabel}</LinkButton>
        {!i.acknowledgedAt && <AcknowledgeForm id={i.id} />}
      </div>
    </li>
  );
}

/**
 * Action centre (US-5-06, docs/ux-system.md 5.5 and §9.15): one queue with tabs Approvals, Exceptions,
 * Alerts and Sync. Items come from the underlying records and clear when those resolve; the queue is
 * refreshed on open and every 5 minutes. Owners can group exceptions per site.
 */
/** Plain tab names (ADR-088). UX audit R2: decisions live only in To approve; that tab is a link there, not a list. */
const TAB_TEXT: Record<string, string> = { approvals: "To approve", exceptions: "Problems", alerts: "Alerts for you", sync: "Phone changes to check" };

export default async function ActionCentrePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  // UX audit R2 (one door per job): the old "To decide" list repeated To approve; old links land there.
  if (sp.tab === "approvals") redirect("/approvals");
  const tab = (["exceptions", "alerts", "sync"] as const).find((t) => t === sp.tab) ?? "exceptions";
  const refresh = await refreshActionItems(ctx.organizationId).catch(() => null);
  // Acknowledged items stay listed (after the others) until their record resolves; "Hide acknowledged" filters them.
  const all = (await listActionItems(ctx, { includeAcknowledged: sp.acked !== "0" })).sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt));
  // The To approve count is the same number as the top-bar badge (what you can decide now, ADR-083 §8).
  const counts = { approvals: await myApprovalCount(ctx).catch(() => 0), exceptions: all.filter((i) => i.tab === "exceptions" && !i.acknowledgedAt).length };
  const alerts = tab === "alerts" ? (await listMyNotifications(ctx, { show: "open" })).filter((n) => !n.resolvedAt) : [];
  const kind = sp.kind && ACTION_KINDS.some((k) => k.kind === sp.kind) ? sp.kind : undefined;
  const items = all.filter((i) => i.tab === tab && (!kind || i.kind === kind));
  const kindsHere = ACTION_KINDS.filter((k) => k.tab === tab && all.some((i) => i.kind === k.kind));
  const bySite = sp.group === "site" && ctx.allowedSites.length > 1;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, kind, group: sp.group, acked: sp.acked, ...extra })) if (v) p.set(k, v);
    return `/action-centre?${p.toString()}`;
  };
  const groups: [string, ActionItemView[]][] = bySite
    ? ([...ctx.allowedSites.map((s) => [`${s.code} · ${s.name}`, items.filter((i) => i.siteId === s.id)]), ["Organization", items.filter((i) => !i.siteId)]] as [string, ActionItemView[]][]).filter(([, l]) => l.length > 0)
    : [["", items]];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Problems & alerts"
        actions={
          ctx.can("platform.notification_rule.view") ? (
            <MoreMenu>
              <LinkButton href="/admin/notification-rules" variant="secondary" size="sm">Who gets which message</LinkButton>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for managers and QA: things that went wrong or wait too long at your sites. Tap the button on a row to fix it; press “I&apos;m on it” so others know. A row goes away by itself when it is fixed.</PageIntro>
      {!refresh && <Banner tone="warn" title="This list may be a few minutes old">It could not be updated just now. Open the page again in a minute.</Banner>}
      <nav aria-label="Action centre tabs" className="flex flex-wrap gap-2">
        {/* Problems first; "To approve" last, as a link to the one inbox for decisions. */}
        {[...ACTION_TABS.filter((t) => t.tab !== "approvals"), ...ACTION_TABS.filter((t) => t.tab === "approvals")].map((t) => (
          <Link
            key={t.tab}
            href={t.tab === "approvals" ? "/approvals" : `/action-centre?tab=${t.tab}`}
            aria-current={tab === t.tab ? "page" : undefined}
            className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px]", tab === t.tab ? "border-primary bg-primary-soft font-semibold" : "border-line")}
          >
            {TAB_TEXT[t.tab] ?? t.label}
            {t.tab === "approvals" || t.tab === "exceptions" ? ` · ${counts[t.tab]}` : ""}
            {t.tab === "approvals" && <span aria-hidden>&nbsp;→</span>}
          </Link>
        ))}
      </nav>

      {tab === "sync" ? (
        <SyncConflictSummary ctx={ctx} />
      ) : tab === "alerts" ? (
        <Card>
          <CardTitle action={<LinkButton href="/notifications" variant="ghost" size="sm">All messages</LinkButton>}>Alerts for you</CardTitle>
          {alerts.length === 0 ? (
            <EmptyState title="No alerts for you">When something fails or waits too long and you should know, it appears here.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((n) => (
                <li key={n.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={(SEV[n.severity as keyof typeof SEV] ?? SEV.info).tone}>{(SEV[n.severity as keyof typeof SEV] ?? SEV.info).label}</Chip>
                    <span className="text-[12px] text-muted">{fmtDateTime(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[14px]">
                    <a href={`/notifications/open/${n.id}`} className="text-primary-text hover:underline">{n.title}</a>
                  </p>
                  <p className="text-[13px] text-muted">{n.body}</p>
                  <a href={`/notifications/open/${n.id}`} className={cx(buttonClass("primary", "sm"), "mt-2")} aria-label={`Open: ${n.title}`}>Open</a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Link href={qs({ kind: undefined })} className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4", !kind ? "border-primary bg-primary-soft font-semibold" : "border-line")}>All kinds</Link>
            {kindsHere.map((k) => (
              <Link key={k.kind} href={qs({ kind: k.kind })} className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4", kind === k.kind ? "border-primary bg-primary-soft font-semibold" : "border-line")}>
                {k.label}
              </Link>
            ))}
            {ctx.allowedSites.length > 1 && (
              <Link href={qs({ group: bySite ? undefined : "site" })} className="ml-auto inline-flex min-h-[44px] items-center text-primary-text hover:underline">{bySite ? "Do not group" : "Group by site"}</Link>
            )}
            <Link href={qs({ acked: sp.acked === "0" ? undefined : "0" })} className="inline-flex min-h-[44px] items-center text-primary-text hover:underline">{sp.acked === "0" ? "Show the ones someone is on" : "Hide the ones someone is on"}</Link>
          </div>
          {items.length === 0 ? (
            <EmptyState title="No problems right now">
              Late production orders, low stock, things about to expire, failed jobs and imports, holds, problem reports, delivery receipts nobody confirmed and late orders at your sites appear here.
            </EmptyState>
          ) : (
            groups.map(([label, list]) => (
              <section key={label || "all"} className="mb-2">
                {label && <h2 className="mt-2 font-display text-[15px] font-semibold">{label} · {list.length}</h2>}
                <ul className="divide-y divide-line">
                  {list.map((i) => (
                    <ItemRow key={i.id} i={i} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </Card>
      )}
    </div>
  );
}
