import Link from "next/link";
import { redirect } from "next/navigation";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { requireContext } from "@/lib/auth/context";
import { ACTION_KINDS, type ActionItemView, listActionItems, refreshActionItems } from "@/modules/action-centre";
import { Card, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { currentHref, isInternalPath, recordHref } from "@/lib/record-links";
import { Banner, Chip } from "@/ui/status";
import { AcknowledgeForm } from "./forms";
import { registerAppHooks } from "@/modules/wiring";
import { SyncConflictSummary } from "../sync/conflict-summary"; // W4D (US-7-05)

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

import { codeLast } from "@/lib/code-last";
import { plainDatesIn } from "@/lib/plain-date";

export const metadata = { title: "Problems & alerts" };
export const dynamic = "force-dynamic";

const SEV = { critical: { tone: "bad", label: "Critical" }, warning: { tone: "warn", label: "Warning" }, info: { tone: "info", label: "Info" } } as const;

function age(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

/** Filter chips by kind: real links, 44 px tall (UX re-audit C #2). */
function KindChips({ kinds, kind, qs }: { kinds: { kind: string; label: string }[]; kind?: string; qs: (x: Record<string, string | undefined>) => string }) {
  const chip = (on: boolean) => cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px]", on ? "border-primary bg-primary-soft font-semibold" : "border-line hover:bg-surface-2");
  return (
    <nav aria-label="Show one kind" className="mt-2 flex flex-wrap gap-2 sm:mt-0" data-testid="kind-chips">
      <Link href={qs({ kind: undefined })} aria-current={!kind ? "page" : undefined} className={chip(!kind)}>All kinds</Link>
      {kinds.map((k) => (
        <Link key={k.kind} href={qs({ kind: k.kind })} aria-current={kind === k.kind ? "page" : undefined} className={chip(kind === k.kind)}>
          {k.label}
        </Link>
      ))}
    </nav>
  );
}

type SP = { tab?: string; kind?: string; group?: string; acked?: string };

/** The button word from the current catalogue: items opened before a rename keep their stored word ("Open CAPA"). */
const buttonWord = (i: ActionItemView) => ACTION_KINDS.find((k) => k.kind === i.kind)?.actionLabel ?? i.actionLabel;

/** `first`: only the first row's button is green, the others secondary (one next step per screen, like To approve). */
function ItemRow({ i, first = false }: { i: ActionItemView; first?: boolean }) {
  const title = codeLast(plainDatesIn(i.title));
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
          {title.text}
          {(i.recordNumber || title.codes.length > 0) && <span className="ml-1 font-mono text-[12px] text-muted">{i.recordNumber ?? title.codes.join(" · ")}</span>}
        </p>
        {i.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{plainDatesIn(i.detail)}</p>}
        {i.acknowledgementNote && <p className="mt-0.5 text-[12px] text-muted">Note: {i.acknowledgementNote}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start">
        <LinkButton href={isInternalPath(i.link) ? currentHref(i.link) : (recordHref(i.entityType, i.entityId) ?? "/action-centre")} variant={first ? "primary" : "secondary"} size="sm">{buttonWord(i)}</LinkButton>
        {!i.acknowledgedAt && <AcknowledgeForm id={i.id} />}
      </div>
    </li>
  );
}

/**
 * Problems & alerts (US-5-06, ADR-082 §4, docs/LEGACY_SCREENS.md): exceptions only. Decisions live in
 * "To approve" (/approvals) and messages in "Messages" (/notifications); the former "To decide" and
 * "Alerts for you" tabs duplicated them, so their old addresses (?tab=approvals, ?tab=alerts) redirect
 * there. Items come from the underlying records and clear when those resolve; the queue is refreshed on
 * open and every 5 minutes. Owners can group problems per site.
 */
const TABS = [
  { tab: "exceptions", label: "Problems" },
  { tab: "sync", label: "Phone changes to check" },
] as const;

export default async function ActionCentrePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  // Superseded tabs keep their old links alive (notifications, bookmarks, e-mails).
  if (sp.tab === "approvals") redirect("/approvals");
  if (sp.tab === "alerts") redirect("/notifications");
  const canSync = ctx.can("platform.sync_conflict.view");
  const tabs = TABS.filter((t) => t.tab !== "sync" || canSync);
  const tab = tabs.find((t) => t.tab === sp.tab)?.tab ?? "exceptions";
  const refresh = await refreshActionItems(ctx.organizationId).catch(() => null);
  // Acknowledged items stay listed (after the others) until their record resolves; "Hide acknowledged" filters them.
  const all = (await listActionItems(ctx, { includeAcknowledged: sp.acked !== "0" })).sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt));
  const problems = all.filter((i) => i.tab === "exceptions" && !i.acknowledgedAt).length;
  // An old link filtered on a decision kind (e.g. ?kind=approval.stock_adjustment): decisions are in To approve.
  if (sp.kind && ACTION_KINDS.some((k) => k.kind === sp.kind && k.tab === "approvals")) redirect("/approvals");
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
  // Round 4 leftover: one green button on the screen, on the first row shown (like To approve).
  const firstId = groups[0]?.[1][0]?.id;

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
      <p className="text-[13px] text-fg-2">
        Decisions waiting for you are under <Link href="/approvals" className="font-medium text-primary-text underline-offset-2 hover:underline">To approve</Link>; messages for you are under <Link href="/notifications" className="font-medium text-primary-text underline-offset-2 hover:underline">Messages</Link>.
      </p>
      <nav aria-label="Problems and alerts tabs" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.tab}
            href={`/action-centre?tab=${t.tab}`}
            aria-current={tab === t.tab ? "page" : undefined}
            className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px]", tab === t.tab ? "border-primary bg-primary-soft font-semibold" : "border-line")}
          >
            {t.label}
            {t.tab === "exceptions" ? ` · ${problems}` : ""}
          </Link>
        ))}
      </nav>

      {tab === "sync" ? (
        <SyncConflictSummary ctx={ctx} />
      ) : (
        <Card>
          {/* Round 4 (UX re-audit C #2): 44 px chips, folded on phones so they do not fill the first screen. */}
          <details className="mb-3 sm:hidden" open={!!kind}>
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
              Show one kind only{kind ? `: ${ACTION_KINDS.find((k) => k.kind === kind)?.label ?? ""}` : ""}
            </summary>
            <KindChips kinds={kindsHere} kind={kind} qs={qs} />
          </details>
          <div className="mb-3 hidden sm:block">
            <KindChips kinds={kindsHere} kind={kind} qs={qs} />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            {ctx.allowedSites.length > 1 && (
              <Link href={qs({ group: bySite ? undefined : "site" })} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-primary-text hover:bg-primary-soft">{bySite ? "Do not group" : "Group by site"}</Link>
            )}
            <Link href={qs({ acked: sp.acked === "0" ? undefined : "0" })} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-primary-text hover:bg-primary-soft">{sp.acked === "0" ? "Show the ones someone is on" : "Hide the ones someone is on"}</Link>
          </div>
          {items.length === 0 ? (
            <EmptyState title="No problems right now">
              Late production orders, products running low, lots about to expire, stock stopped by QA, problem reports, deliveries without a signed receipt and late customer orders at your sites appear here. Nothing to do.
            </EmptyState>
          ) : (
            groups.map(([label, list]) => (
              <section key={label || "all"} className="mb-2">
                {label && <h2 className="mt-2 font-display text-[15px] font-semibold">{label} · {list.length}</h2>}
                <ul className="divide-y divide-line">
                  {list.map((i) => (
                    <ItemRow key={i.id} i={i} first={i.id === firstId} />
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
