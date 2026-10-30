import Link from "next/link";
import { ArrowRight, ClipboardList, Factory, PackagePlus, ScanLine, ShieldCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import type { OperatorTile } from "@/modules/analytics";
import type { FloorTask } from "@/modules/production";
import { EmptyState } from "@/ui/core";
import { TaskCards } from "../production/task-cards";

const ICON: Record<OperatorTile["key"], ReactNode> = {
  receive: <PackagePlus size={26} />,
  scan: <ScanLine size={26} />,
  batches: <Factory size={26} />,
  qa: <ShieldCheck size={26} />,
  dispatch: <Truck size={26} />,
};

/** Large task tiles for operators without production tasks (warehouse, QA): verbs, live counts, 44 px+ targets. */
export function OperatorHome({ tiles, siteLabel, updated }: { tiles: OperatorTile[]; siteLabel: string; updated: string }) {
  if (tiles.length === 0)
    return <EmptyState title="No tasks for your role yet">Your role has no task screens at this site. Ask your site manager if you need access.</EmptyState>;
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              className="group flex min-h-[132px] items-start gap-4 rounded-[16px] border border-line bg-surface p-5 transition-shadow hover:shadow-[0_4px_12px_rgba(28,27,24,.08)]"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary-text">{ICON[t.key]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[18px] font-semibold text-fg">{t.title}</span>
                  <ArrowRight size={18} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="mt-1 block text-[13px] text-fg-2">{t.description}</span>
                <span className="mt-3 flex items-baseline gap-2">
                  <span className="tabular text-[28px] font-semibold leading-none text-fg">{t.count.toLocaleString("en-PH")}</span>
                  <span className="text-[13px] text-muted">{t.countLabel}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-[12px] text-muted">
        Counts for {siteLabel} · updated {updated} · all figures from posted transactions
      </p>
    </>
  );
}

type QuickAction = { href: string; label: string; icon: ReactNode };

/**
 * "Your tasks today" (UX review, operator mockup): 2–3 count tiles, then one card per batch with ONE
 * big green button (myFloorTasks), then small quick actions. Replaces the ADR-082 "Your next task"
 * card: the first card is that task, and batches without a production order are included.
 */
export function TasksToday({ tasks, counts, tiles, canDailyCount }: { tasks: FloorTask[]; counts: { forYou: number; weighing: number; waiting: number }; tiles: OperatorTile[]; canDailyCount: boolean }) {
  const quick: QuickAction[] = [];
  const scan = tiles.find((t) => t.key === "scan");
  if (scan) quick.push({ href: scan.href, label: "Scan or search", icon: <ScanLine size={18} aria-hidden /> });
  if (canDailyCount) quick.push({ href: "/production/today", label: "Daily count", icon: <ClipboardList size={18} aria-hidden /> });
  for (const t of tiles) if (t.key !== "scan" && t.key !== "batches") quick.push({ href: t.href, label: t.title, icon: ICON[t.key] });
  const COUNT: [string, number][] = [
    ["Batches for you", counts.forYou],
    ["Weighing", counts.weighing],
    ["Waiting", counts.waiting],
  ];
  return (
    <>
      <ul className="mb-5 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Your tasks in numbers">
        {COUNT.map(([label, n]) => (
          <li key={label} className="rounded-[16px] border border-line bg-surface px-3 py-3 sm:px-4">
            <p className="tabular text-[26px] font-semibold leading-none text-fg">{n}</p>
            <p className="mt-1.5 text-[12.5px] leading-tight text-fg-2 sm:text-[13px]">{label}</p>
          </li>
        ))}
      </ul>
      <h2 className="mb-2.5 text-[16px] font-semibold text-fg">Your tasks today</h2>
      <TaskCards
        tasks={tasks}
        empty={<EmptyState title="Nothing for you right now.">Your supervisor plans the next batch.</EmptyState>}
      />
      {tasks.length > 0 && (
        <p className="mt-3 text-[14px]">
          <Link href="/production/orders" className="font-medium text-primary-text underline">
            My work
          </Link>
        </p>
      )}
      {quick.length > 0 && (
        <nav aria-label="Quick actions" className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Quick actions</h2>
          <ul className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <li key={q.href}>
                <Link href={q.href} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-fg hover:bg-surface-2 [&_svg]:size-[18px]">
                  {q.icon}
                  {q.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
