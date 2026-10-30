import { Hourglass } from "lucide-react";
import Link from "next/link";
import type { FloorTask } from "@/modules/production";
import { LinkButton, cx } from "@/ui/core";

/**
 * Operator task cards (UX review "Your tasks today"): product, batch, "Step 2 of 7 · Weighing", a
 * progress bar and ONE big green button. A task the user cannot do says who does it (first name or
 * role, never an e-mail address) and offers no button that would only be refused.
 */
export function TaskCard({ t }: { t: FloorTask }) {
  return (
    <article className="flex min-w-0 flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-4 sm:p-5" data-testid="floor-task" aria-label={`${t.title}: ${t.productName}, batch ${t.batchNumber}`}>
      <div className="min-w-0">
        <p className="text-[19px] font-semibold leading-snug text-fg">{t.title}</p>
        <p className="mt-0.5 text-[14px] text-fg-2">
          {t.productName} · <span className="font-mono text-[13px]">{t.batchNumber}</span>
          {t.assignedToMe && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-medium text-primary-text">Yours</span>}
        </p>
      </div>
      <div>
        <p className="flex items-center justify-between gap-2 text-[13px] text-fg-2">
          <span>{t.stepLabel}</span>
          <span className="tabular text-muted">{t.percent}%</span>
        </p>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.percent} aria-label={`${t.batchNumber} progress`}>
          <div className={cx("h-full rounded-full", t.canDo ? "bg-primary" : "bg-line-strong")} style={{ width: `${Math.max(t.percent, 3)}%` }} />
        </div>
      </div>
      {t.canDo ? (
        <LinkButton href={t.href} variant="cta" size="lg" className="mt-1 w-full justify-center text-[17px]">
          {t.buttonLabel}
        </LinkButton>
      ) : (
        <div className="mt-1 rounded-[14px] bg-surface-2/70 px-3.5 py-3 text-[14px]">
          <p className="flex items-center gap-1.5 font-medium text-fg">
            <Hourglass size={15} aria-hidden /> {t.waitingFor ? `Waiting for ${t.waitingFor}` : t.kind === "wait" ? "Nothing to do until then" : "Waiting"}
          </p>
          <p className="mt-0.5 text-[13px] text-fg-2">{t.hint}</p>
          <Link href={t.href} className="mt-1.5 inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text underline">
            Follow progress
          </Link>
        </div>
      )}
    </article>
  );
}

export function TaskCards({ tasks, empty }: { tasks: FloorTask[]; empty?: React.ReactNode }) {
  if (tasks.length === 0) return <>{empty ?? null}</>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tasks.map((t) => (
        <li key={t.batchId} className="min-w-0">
          <TaskCard t={t} />
        </li>
      ))}
    </ul>
  );
}
