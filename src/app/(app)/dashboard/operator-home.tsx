import Link from "next/link";
import { ArrowRight, ArrowRightLeft, ClipboardCheck, ClipboardList, Factory, PackageCheck, PackagePlus, ScanLine, ShieldCheck, Truck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { OperatorTile } from "@/modules/analytics";
import type { FloorTask } from "@/modules/production";
import { fmtDateTime } from "@/lib/qty";
import { EmptyState } from "@/ui/core";
import { TaskCards } from "../production/task-cards";
import { floorQuickKeys } from "./home-next";

const ICON: Record<OperatorTile["key"], ReactNode> = {
  receive: <PackagePlus size={26} />,
  scan: <ScanLine size={26} />,
  batches: <Factory size={26} />,
  qa: <ShieldCheck size={26} />,
  dispatch: <Truck size={26} />,
  putaway: <PackageCheck size={26} />,
  move: <ArrowRightLeft size={26} />,
  count: <ClipboardCheck size={26} />,
  fix: <Wrench size={26} />,
};

/** Warehouse tiles (usability test 2026-10-30): six big tiles, two per row on a phone, with live counts. */
const WAREHOUSE_KEYS: OperatorTile["key"][] = ["putaway", "move", "count", "fix"];

/** Large task tiles for operators without production tasks (warehouse, QA): verbs, live counts, 44 px+ targets. */
export function OperatorHome({ tiles, siteLabel, updated }: { tiles: OperatorTile[]; siteLabel: string; updated: string }) {
  if (tiles.length === 0)
    return <EmptyState title="No tasks for your role yet">Your role has no task screens at this site. Ask your site manager if you need access.</EmptyState>;
  if (tiles.some((t) => WAREHOUSE_KEYS.includes(t.key))) return <WarehouseTiles tiles={tiles} siteLabel={siteLabel} updated={updated} />;
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
        Numbers for {siteLabel} · updated {updated}
      </p>
    </>
  );
}

function WarehouseTiles({ tiles, siteLabel, updated }: { tiles: OperatorTile[]; siteLabel: string; updated: string }) {
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3" aria-label="What do you need to do?" data-testid="warehouse-tiles">
        {tiles.map((t) => (
          <li key={t.key} className="min-w-0">
            <Link
              href={t.href}
              data-testid={`tile-${t.key}`}
              className="group flex h-full min-h-[148px] flex-col gap-2 rounded-[18px] border border-line bg-surface p-4 transition-shadow hover:shadow-[0_4px_12px_rgba(28,27,24,.08)] active:bg-surface-2 sm:min-h-[168px] sm:p-5"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary-text">{ICON[t.key]}</span>
                <span className="tabular text-[30px] font-semibold leading-none text-fg">{t.count.toLocaleString("en-PH")}</span>
              </span>
              <span className="text-[19px] font-semibold leading-tight text-fg">{t.title}</span>
              <span className="text-[13px] leading-snug text-fg-2">{t.countLabel}</span>
              <span className="hidden text-[13px] leading-snug text-muted sm:block">{t.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-[12px] text-muted">
        Numbers for {siteLabel} · updated {updated}
      </p>
    </>
  );
}

type QuickAction = { href: string; label: string; icon: ReactNode };

/** One open message on the operator Home (desktop side panel). */
export type HomeMessage = { id: string; title: string; /** Record codes moved to the end of the title (codeLast), shown small. */ codes?: string; at: Date };

/**
 * "Your tasks today" (UX review, operator mockup): 2–3 count tiles, then one card per batch with ONE
 * big green button (myFloorTasks), then small quick actions. Replaces the ADR-082 "Your next task"
 * card: the first card is that task, and batches without a production order are included.
 * Live check 2026-11-06 (desktop ≥ 1280 px): the right third holds "Today" (quick actions) and the newest messages
 * instead of staying empty; phones and tablets keep one column (messages stay behind the bell there). Warehouse jobs
 * (Put away, Move) are not an operator's quick actions.
 */
export function TasksToday({ tasks, counts, tiles, canDailyCount, messages = [] }: { tasks: FloorTask[]; counts: { forYou: number; weighing: number; waiting: number }; tiles: OperatorTile[]; canDailyCount: boolean; messages?: HomeMessage[] }) {
  const quick: QuickAction[] = [];
  const scan = tiles.find((t) => t.key === "scan");
  if (scan) quick.push({ href: scan.href, label: "Scan or search", icon: <ScanLine size={18} aria-hidden /> });
  if (canDailyCount) quick.push({ href: "/production/today", label: "Today's count", icon: <ClipboardList size={18} aria-hidden /> });
  const keys = floorQuickKeys(tiles);
  for (const t of tiles) if (keys.includes(t.key)) quick.push({ href: t.href, label: t.title, icon: ICON[t.key] });
  const COUNT: [string, number][] = [
    ["Batches for you", counts.forYou],
    ["Weighing", counts.weighing],
    ["Waiting", counts.waiting],
  ];
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start xl:gap-5">
      <div className="min-w-0">
        <ul className="mb-5 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Your tasks in numbers">
          {COUNT.map(([label, n]) => (
            <li key={label} className="rounded-[16px] border border-line bg-surface px-3 py-3 sm:px-4">
              <p className="tabular text-[26px] font-semibold leading-none text-fg">{n}</p>
              <p className="mt-1.5 text-[12.5px] leading-tight text-fg-2 sm:text-[13px]">{label}</p>
            </li>
          ))}
        </ul>
        <h2 className="mb-2.5 text-[16px] font-semibold text-fg">Your tasks today</h2>
        <TaskCards tasks={tasks} gridClass="sm:grid-cols-2" empty={<EmptyState title="Nothing for you right now.">Your supervisor plans the next batch.</EmptyState>} />
        {tasks.length > 0 && (
          <p className="mt-3 text-[14px]">
            <Link href="/production/orders" className="font-medium text-primary-text underline">
              My work
            </Link>
          </p>
        )}
      </div>
      <aside aria-label="Today" className="min-w-0 xl:rounded-[20px] xl:border xl:border-line xl:bg-surface xl:p-4">
        {quick.length > 0 && (
          <nav aria-label="Quick actions" className="mt-6 xl:mt-0">
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              <span className="xl:hidden">Quick actions</span>
              <span className="hidden xl:inline">Today</span>
            </h2>
            <ul className="flex flex-wrap gap-2 xl:flex-col">
              {quick.map((q) => (
                <li key={q.href}>
                  <Link href={q.href} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-fg hover:bg-surface-2 xl:flex xl:w-full [&_svg]:size-[18px]">
                    {q.icon}
                    {q.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <section aria-labelledby="home-messages-h" className="hidden xl:mt-5 xl:block xl:border-t xl:border-line xl:pt-4">
          <h2 id="home-messages-h" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
            Messages for you
          </h2>
          {messages.length === 0 ? (
            <p className="text-[14px] text-fg-2">No new messages.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {messages.map((m) => (
                <li key={m.id}>
                  <a href={`/notifications/open/${m.id}`} className="block min-h-[44px] py-2 text-[14px] text-fg hover:text-primary-text">
                    <span className="block font-medium">
                      {m.title}
                      {m.codes && <span className="ml-1 font-mono text-[12px] font-normal text-muted">{m.codes}</span>}
                    </span>
                    <span className="block text-[12px] text-muted">{fmtDateTime(m.at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="mt-1 inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">
            All messages
          </Link>
        </section>
      </aside>
    </div>
  );
}
