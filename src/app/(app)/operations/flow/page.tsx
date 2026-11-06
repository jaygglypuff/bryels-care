import Link from "next/link";
import { ArrowRight, BellOff } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ageWords, getWorkFlow, type FlowCount, type FlowStage } from "@/modules/analytics";
import { EmptyState, PageHeader, cx } from "@/ui/core";
import { PageIntro } from "@/ui/guide";

export const dynamic = "force-dynamic";
export const metadata = { title: "How work flows" };

/**
 * "How work flows" (ADR-106 §5, ADR-110 C0; docs/END_TO_END_FLOW.md C0): one row per stage of an order, from "Ask to
 * buy" to "Invoice". Each row: the stage in plain words, who does it, how many things wait there now, how old the
 * oldest is, and one button to the screen where that person does it. A row is red when something waits there and no
 * message was sent about it (it waits on nobody). Tapping a number lists the records (/operations/flow/<count>).
 * Phone: a numbered list of cards. From 1024 px: a table. All numbers are for the current site (getWorkFlow).
 */
export default async function WorkFlowPage() {
  const ctx = await requireContext();
  const wf = await getWorkFlow(ctx);
  const red = wf.stages.filter((s) => s.waitsOnNobody).length;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="How work flows" subtitle={wf.siteName} />
      <PageIntro>
        This screen is for following the whole road of an order: buy, receive, check, make, check again, send and bill. Each row says who does it, how many things wait there now, and has one button to
        the screen for it. Tap a number to see what waits. Red means something waits and nobody was told.
      </PageIntro>
      {wf.stages.length === 0 ? (
        <EmptyState title="Nothing to show for your role">Your role does not show any step of the work at this site. Ask your site manager if you need it.</EmptyState>
      ) : (
        <>
          {red > 0 && (
            <p className="flex items-center gap-2 rounded-[12px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-4 py-3 text-[14px] font-medium text-[var(--bad-fg)]" data-testid="flow-red-summary">
              <BellOff size={16} aria-hidden /> {red === 1 ? "1 step has" : `${red} steps have`} work that nobody was told about.
            </p>
          )}
          <ol className="flex flex-col gap-3 lg:hidden" aria-label="Steps of the work" data-testid="flow-list">
            {wf.stages.map((s) => (
              <li key={s.key}>
                <StageCard s={s} />
              </li>
            ))}
          </ol>
          <div className="hidden lg:block">
            <StageTable stages={wf.stages} />
          </div>
          <p className="text-center text-[12px] text-muted">Numbers for {wf.siteName} · {fmtDateTime(wf.generatedAt)}</p>
        </>
      )}
    </div>
  );
}

function CountLinks({ s }: { s: FlowStage }) {
  return (
    <ul className="flex flex-col gap-1">
      {s.counts.map((c) => (
        <li key={c.key}>
          <CountLink c={c} />
        </li>
      ))}
    </ul>
  );
}

function CountLink({ c }: { c: FlowCount }) {
  const words = c.capped ? c.words.replace(/^[\d,]+/, (n) => `${n}+`) : c.words;
  if (c.count === 0) return <span className="inline-flex min-h-[44px] items-center text-[14px] text-muted">{words}</span>;
  return (
    <Link href={`/operations/flow/${c.key}`} data-testid={`flow-count-${c.key}`} className={cx("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium underline-offset-2 hover:underline", c.untold > 0 ? "text-[var(--bad-fg)]" : "text-primary-text")}>
      {words}
      {c.untold > 0 && <span className="text-[13px] font-normal">({c.untold === c.count ? "nobody told" : `${c.untold} nobody told`})</span>}
    </Link>
  );
}

function StageCard({ s }: { s: FlowStage }) {
  const age = ageWords(s.oldestAt);
  return (
    <section
      aria-label={`${s.n}. ${s.title}`}
      data-testid={`flow-stage-${s.key}`}
      data-red={s.waitsOnNobody ? "yes" : "no"}
      className={cx("rounded-[16px] border bg-surface p-4", s.waitsOnNobody ? "border-[var(--bad-bd)] border-l-4 bg-[var(--bad-bg)]/40" : "border-line")}
    >
      <div className="flex items-start gap-3">
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold tabular", s.total > 0 ? "bg-cta text-white" : "bg-surface-2 text-fg-2")} aria-hidden>
          {s.n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-tight text-fg">{s.title}</h2>
          <p className="mt-0.5 text-[14px] text-fg-2">{s.who}</p>
          <div className="mt-2">
            <CountLinks s={s} />
          </div>
          {age && s.total > 0 && <p className="text-[13px] text-fg-2">Oldest: {age === "today" ? "from today" : `${age} waiting`}</p>}
          {s.waitsOnNobody && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-[var(--bad-fg)]">
              <BellOff size={14} aria-hidden /> Nobody was told about this. Tell the person who does it.
            </p>
          )}
        </div>
      </div>
      <Link href={s.button.href} className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-[15px] font-semibold text-fg hover:bg-surface-2">
        {s.button.label} <ArrowRight size={16} aria-hidden />
      </Link>
    </section>
  );
}

function StageTable({ stages }: { stages: FlowStage[] }) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-[16px] border border-line bg-surface text-left text-[14px]" data-testid="flow-table">
      <caption className="sr-only">Steps of the work, in order</caption>
      <thead className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
        <tr>
          <th scope="col" className="w-10 px-3 py-2.5">#</th>
          <th scope="col" className="px-3 py-2.5">Step</th>
          <th scope="col" className="px-3 py-2.5">Who</th>
          <th scope="col" className="px-3 py-2.5">Waiting now</th>
          <th scope="col" className="px-3 py-2.5">Oldest</th>
          <th scope="col" className="px-3 py-2.5"><span className="sr-only">Open</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {stages.map((s) => {
          const age = s.total > 0 ? ageWords(s.oldestAt) : null;
          return (
            <tr key={s.key} data-testid={`flow-row-${s.key}`} data-red={s.waitsOnNobody ? "yes" : "no"} className={cx(s.waitsOnNobody && "bg-[var(--bad-bg)]/50 [&>td:first-child]:border-l-4 [&>td:first-child]:border-l-[var(--bad-bd)]")}>
              <td className="px-3 py-2 align-top">
                <span className={cx("grid size-8 place-items-center rounded-full text-[13px] font-semibold", s.total > 0 ? "bg-cta text-white" : "bg-surface-2 text-fg-2")}>{s.n}</span>
              </td>
              <th scope="row" className="px-3 py-2 align-top font-semibold text-fg">
                {s.title}
                {s.waitsOnNobody && (
                  <span className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-[var(--bad-fg)]">
                    <BellOff size={12} aria-hidden /> Nobody was told
                  </span>
                )}
              </th>
              <td className="px-3 py-2 align-top text-fg-2">{s.who}</td>
              <td className="px-3 py-1 align-top">
                <CountLinks s={s} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top text-fg-2">{age ? (age === "today" ? "today" : age) : "—"}</td>
              <td className="px-3 py-2 text-right align-top">
                <Link href={s.button.href} className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-4 text-[14px] font-medium text-fg hover:bg-surface-2">
                  {s.button.label} <ArrowRight size={14} aria-hidden />
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
