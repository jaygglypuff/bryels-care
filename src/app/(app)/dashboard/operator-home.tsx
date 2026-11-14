import Link from "next/link";
import { ArrowRight, ArrowRightLeft, ClipboardCheck, Factory, PackageCheck, PackagePlus, ScanLine, ShieldCheck, Truck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { OperatorTile } from "@/modules/analytics";
import type { FloorTask } from "@/modules/production";
import { fmtDateTime } from "@/lib/qty";
import { EmptyState } from "@/ui/core";
import { TaskCard } from "../production/task-cards";

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
              className="group flex min-h-[132px] items-start gap-4 rounded-[8px] border border-line bg-surface p-5 transition-shadow hover:shadow-[0_4px_12px_rgba(28,27,24,.08)]"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary-text">{ICON[t.key]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[18px] font-semibold text-fg">{t.title}</span>
                  <ArrowRight size={18} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="mt-1 block text-[13px] text-fg-2">{t.description}</span>
                <span className="mt-3 flex items-baseline gap-2">
                  <span className="tabular text-stat leading-none text-fg">{t.count.toLocaleString("en-PH")}</span>
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
              className="group flex h-full min-h-[148px] flex-col gap-2 rounded-[8px] border border-line bg-surface p-4 transition-shadow hover:shadow-[0_4px_12px_rgba(28,27,24,.08)] active:bg-surface-2 sm:min-h-[168px] sm:p-5"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="grid size-12 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary-text">{ICON[t.key]}</span>
                <span className="tabular text-stat leading-none text-fg">{t.count.toLocaleString("en-PH")}</span>
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


/** One open message on the operator Home (desktop side panel). */
export type HomeMessage = { id: string; title: string; /** Record codes moved to the end of the title (codeLast), shown small. */ codes?: string; at: Date };

/**
 * "My jobs" for floor people (round 5, ADR-129; A report §4 "Home ("My jobs") for floor roles"):
 * 1. one big card at the top: the next job, with its verb button (the only green button);
 * 2. "Waiting for you to check": weighings and steps someone else did that this person may check (A report #11, B13);
 * 3. "Later": the other jobs, full-width rows; jobs that only wait (curing, another person's check) come last.
 * No number tiles ("0 Weighing" while a weighing waited for the checker, B13) and no quick actions: the bottom bar holds
 * Scan, Batches and Help. On desktop (≥ 1280 px) the right third shows the newest messages.
 */
export function TasksToday({ tasks, messages = [] }: { tasks: FloorTask[]; messages?: HomeMessage[] }) {
  const checks = tasks.filter((t) => t.kind === "check" && t.canDo);
  const work = tasks.filter((t) => !checks.includes(t));
  // The next job: my own work first; with nothing of my own to do, the first check.
  const first = work.find((t) => t.canDo) ?? checks[0] ?? null;
  const restChecks = checks.filter((t) => t !== first);
  const later = work.filter((t) => t !== first);
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start xl:gap-5">
      <div className="min-w-0 space-y-5">
        {first ? (
          <section aria-labelledby="next-job-h" data-testid="next-job">
            <h2 id="next-job-h" className="mb-2.5 text-[16px] font-semibold text-fg">Your next job</h2>
            <TaskCard t={first} first />
          </section>
        ) : (
          <EmptyState title="Nothing for you right now.">Your supervisor plans the next batch. New work shows here.</EmptyState>
        )}
        {restChecks.length > 0 && (
          <section aria-labelledby="to-check-h" data-testid="home-checks">
            <h2 id="to-check-h" className="mb-2.5 text-[16px] font-semibold text-fg">Waiting for you to check</h2>
            <ul className="grid gap-3">
              {restChecks.map((t) => (
                <li key={t.batchId} className="min-w-0">
                  <TaskCard t={t} first={false} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {later.length > 0 && (
          <section aria-labelledby="later-h">
            <h2 id="later-h" className="mb-2.5 text-[16px] font-semibold text-fg">Later</h2>
            <ul className="grid gap-3">
              {[...later.filter((t) => t.canDo), ...later.filter((t) => !t.canDo)].map((t) => (
                <li key={t.batchId} className="min-w-0">
                  <TaskCard t={t} first={false} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside aria-label="Messages for you" className="hidden min-w-0 xl:block xl:rounded-[8px] xl:border xl:border-line xl:bg-surface xl:p-4">
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
      </aside>
    </div>
  );
}
