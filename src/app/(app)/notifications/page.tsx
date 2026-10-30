import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listMyNotifications } from "@/modules/platform";
import { Card, EmptyState, LinkButton, PageHeader, buttonClass, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { acknowledgeAction, markAllReadAction, markReadAction } from "./actions";

export const metadata = { title: "Notifications" };

const SEVERITY = { critical: { tone: "bad", label: "Critical" }, warning: { tone: "warn", label: "Warning" }, info: { tone: "info", label: "Info" } } as const;

/** Action centre: the signed-in user's own notifications (self-service, no permission string needed). */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireContext();
  const { show } = await searchParams;
  const all = show === "all";
  const items = await listMyNotifications(ctx, { show: all ? "all" : "open" });
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        subtitle="Alerts and items waiting for you. Tap Open to go to the record. Acknowledge an item once you are dealing with it; it stays in your history."
        actions={
          <>
            <LinkButton href={all ? "/notifications" : "/notifications?show=all"} variant="secondary" size="sm">{all ? "Open only" : "Show history"}</LinkButton>
            {unread > 0 && (
              <form action={markAllReadAction}>
                <button className={buttonClass("secondary", "sm")}>Mark all read</button>
              </form>
            )}
          </>
        }
      />
      {ctx.can("quality.disposition.view") && (
        <p className="text-[13px] text-muted">
          QA decisions waiting are listed in the <Link className="text-primary-text hover:underline" href="/quality">QA queue</Link>.
        </p>
      )}
      <Card>
        {items.length === 0 ? (
          <EmptyState title={all ? "No notifications yet" : "Nothing needs your attention"}>
            Failed background jobs, reconciliation differences and other alerts for your role appear here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const sev = SEVERITY[n.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
              return (
                <li key={n.id} className={cx("flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between", !n.readAt && "font-medium")}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={sev.tone}>{sev.label}</Chip>
                      {!n.readAt && <span className="text-[11px] font-semibold uppercase text-primary-text">New</span>}
                      <span className="text-[12px] text-muted">{fmtDateTime(n.createdAt)}</span>
                    </div>
                    {/* ADR-075: every notification opens its record (plain <a>: opening marks it read, so no prefetch). */}
                    <p className="mt-1 text-[14px] text-fg">
                      <a href={`/notifications/open/${n.id}`} className="text-primary-text hover:underline">{n.title}</a>
                    </p>
                    <p className="mt-0.5 break-words text-[13px] font-normal text-muted">{n.body}</p>
                    {n.acknowledgedAt && <p className="mt-0.5 text-[12px] text-muted">Acknowledged {fmtDateTime(n.acknowledgedAt)}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a href={`/notifications/open/${n.id}`} className={buttonClass("primary", "sm")} aria-label={`Open: ${n.title}`}>
                      Open
                    </a>
                  {!n.acknowledgedAt && (
                    <div className="flex shrink-0 gap-2">
                      {!n.readAt && (
                        <form action={markReadAction}>
                          <input type="hidden" name="id" value={n.id} />
                          <button className={buttonClass("ghost", "sm")}>Mark read</button>
                        </form>
                      )}
                      <form action={acknowledgeAction}>
                        <input type="hidden" name="id" value={n.id} />
                        <button className={buttonClass("secondary", "sm")}>Acknowledge</button>
                      </form>
                    </div>
                  )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
