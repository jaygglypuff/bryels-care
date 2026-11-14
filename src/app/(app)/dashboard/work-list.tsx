import Link from "next/link";
import { ArrowRight, BellOff } from "lucide-react";
import { ageWords, type FlowCount, type FlowCountKey } from "@/modules/analytics";
import { cx } from "@/ui/core";

/**
 * A role's work list on Home (ADR-110 C11 procurement, C13 warehouse): one line per thing to do, with how many wait,
 * how old the oldest is, and one button. The numbers are the "How work flows" counts (getWorkFlowCounts), so Home and
 * /operations/flow always agree. Lines the person may not see are already left out by the read model.
 */
export type WorkLine = { key: FlowCountKey; title: string; button: string; href: string };

export const PROCUREMENT_LINES: readonly WorkLine[] = [
  { key: "pr_to_order", title: "Requests to order", button: "Make the purchase orders", href: "/procurement/requests?status=approved" },
  { key: "po_to_send", title: "Purchase orders to send", button: "Send them", href: "/procurement/orders?status=approved" },
  { key: "po_late", title: "Deliveries late", button: "See the late deliveries", href: "/procurement/expected" },
  { key: "po_due_today", title: "Deliveries due today", button: "See today's deliveries", href: "/procurement/expected" },
];

export const WAREHOUSE_LINES: readonly WorkLine[] = [
  { key: "so_to_pick", title: "To get from shelf", button: "Get from shelf", href: "/sales/picking" },
  { key: "shipments_to_check", title: "Boxes to check (by someone who did not take them)", button: "Check a box", href: "/sales/dispatch#check" },
  { key: "shipments_to_send", title: "To send out", button: "Send out", href: "/sales/dispatch#ready" },
  { key: "shipments_no_proof", title: "Customer has not signed yet", button: "Save the signature", href: "/sales/dispatch#proof" },
];

export function WorkList({ title, lines, counts, testId }: { title: string; lines: readonly WorkLine[]; counts: FlowCount[]; testId: string }) {
  const shown = lines.map((l) => ({ l, c: counts.find((c) => c.key === l.key) })).filter((x): x is { l: WorkLine; c: FlowCount } => !!x.c);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={`${testId}-h`} className="mb-5" data-testid={testId}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={`${testId}-h`} className="text-[16px] font-semibold text-fg">
          {title}
        </h2>
        <Link href="/operations/flow" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">
          How work flows
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface">
        {shown.map(({ l, c }) => {
          const age = c.count > 0 ? ageWords(c.oldestAt) : null;
          return (
            <li key={l.key} data-testid={`work-${l.key}`} className={cx("flex flex-wrap items-center gap-3 px-4 py-3", c.untold > 0 && "border-l-4 border-l-[var(--bad-bd)]")}>
              <span className={cx("tabular w-10 shrink-0 text-stat leading-none", c.count > 0 ? "text-fg" : "text-muted")}>{c.count}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-fg">{l.title}</span>
                <span className="block text-[13px] text-fg-2">
                  {c.count === 0 ? "Nothing waits." : age === "today" ? "Oldest from today." : `Oldest waits ${age}.`}
                  {c.untold > 0 && (
                    <span className="ml-1 inline-flex items-center gap-1 font-medium text-[var(--bad-fg)]">
                      <BellOff size={12} aria-hidden /> Nobody was told.
                    </span>
                  )}
                </span>
              </span>
              {c.count > 0 && (
                <Link href={l.href} className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[6px] border border-line-strong bg-surface px-4 text-[14px] font-semibold text-fg hover:bg-surface-2 min-[420px]:w-auto">
                  {l.button} <ArrowRight size={14} aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
