import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ACTION_KINDS, ACTION_TABS, type ActionItemView, listActionItems, refreshActionItems } from "@/modules/action-centre";
import { listMyNotifications } from "@/modules/platform";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { AcknowledgeForm } from "./forms";

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
          {i.acknowledgedAt && <Chip tone="neu">Acknowledged</Chip>}
          <span className="text-[12px] text-muted">{i.kindLabel} · {i.siteCode ?? "Organization"} · open {age(i.ageMinutes)}</span>
        </div>
        <p className="mt-1 text-[14px] font-medium text-fg">
          {i.recordNumber && <span className="mr-1 font-mono">{i.recordNumber}</span>}
          {i.title}
        </p>
        {i.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{i.detail}</p>}
        {i.acknowledgementNote && <p className="mt-0.5 text-[12px] text-muted">Note: {i.acknowledgementNote}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start">
        <LinkButton href={i.link} size="sm">{i.actionLabel}</LinkButton>
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
export default async function ActionCentrePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const tab = (["approvals", "exceptions", "alerts", "sync"] as const).find((t) => t === sp.tab) ?? "approvals";
  const refresh = await refreshActionItems(ctx.organizationId).catch(() => null);
  // Acknowledged items stay listed (after the others) until their record resolves; "Hide acknowledged" filters them.
  const all = (await listActionItems(ctx, { includeAcknowledged: sp.acked !== "0" })).sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt));
  const counts = { approvals: all.filter((i) => i.tab === "approvals" && !i.acknowledgedAt).length, exceptions: all.filter((i) => i.tab === "exceptions" && !i.acknowledgedAt).length };
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
        title="Action centre"
        subtitle="Approvals waiting for you and exceptions in your sites. Each item clears by itself when its record is resolved; acknowledge to say you are on it."
        actions={ctx.can("platform.notification_rule.view") ? <LinkButton href="/admin/notification-rules" variant="secondary" size="sm">Notification rules</LinkButton> : undefined}
      />
      {!refresh && <Banner tone="warn" title="Showing the last refreshed queue">The queue could not be refreshed just now; items may be up to 5 minutes old.</Banner>}
      <nav aria-label="Action centre tabs" className="flex flex-wrap gap-2">
        {ACTION_TABS.map((t) => (
          <Link
            key={t.tab}
            href={`/action-centre?tab=${t.tab}`}
            aria-current={tab === t.tab ? "page" : undefined}
            className={cx("rounded-full border px-3.5 py-1.5 text-[13px]", tab === t.tab ? "border-primary bg-primary-soft font-semibold" : "border-line")}
          >
            {t.label}
            {t.tab === "approvals" || t.tab === "exceptions" ? ` · ${counts[t.tab]}` : ""}
          </Link>
        ))}
      </nav>

      {tab === "sync" ? (
        <Card>
          <EmptyState title="Offline sync arrives in Phase 7">Conflicts from offline devices will be listed here (US-7-06). Nothing is queued on devices yet.</EmptyState>
        </Card>
      ) : tab === "alerts" ? (
        <Card>
          <CardTitle action={<LinkButton href="/notifications" variant="ghost" size="sm">All notifications</LinkButton>}>Alerts for you</CardTitle>
          {alerts.length === 0 ? (
            <EmptyState title="No open alerts">Failed jobs, reconciliation differences, report deliveries and escalations addressed to you appear here.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((n) => (
                <li key={n.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={(SEV[n.severity as keyof typeof SEV] ?? SEV.info).tone}>{(SEV[n.severity as keyof typeof SEV] ?? SEV.info).label}</Chip>
                    <span className="text-[12px] text-muted">{fmtDateTime(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[14px]">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                  <p className="text-[13px] text-muted">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Link href={qs({ kind: undefined })} className={cx("rounded-full border px-3 py-1", !kind ? "border-primary bg-primary-soft font-semibold" : "border-line")}>All kinds</Link>
            {kindsHere.map((k) => (
              <Link key={k.kind} href={qs({ kind: k.kind })} className={cx("rounded-full border px-3 py-1", kind === k.kind ? "border-primary bg-primary-soft font-semibold" : "border-line")}>
                {k.label}
              </Link>
            ))}
            {ctx.allowedSites.length > 1 && (
              <Link href={qs({ group: bySite ? undefined : "site" })} className="ml-auto text-primary-text hover:underline">{bySite ? "Do not group" : "Group by site"}</Link>
            )}
            <Link href={qs({ acked: sp.acked === "0" ? undefined : "0" })} className="text-primary-text hover:underline">{sp.acked === "0" ? "Show acknowledged" : "Hide acknowledged"}</Link>
          </div>
          {items.length === 0 ? (
            <EmptyState title={tab === "approvals" ? "Nothing waits for your approval" : "No open exceptions"}>
              {tab === "approvals" ? "Adjustments, counts, work order releases, QA decisions and setting changes you may approve appear here." : "Late work orders, low stock, expiring lots, failed jobs and imports, holds, deviations, unacknowledged delivery receipts and late orders in your sites appear here."}
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
