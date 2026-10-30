import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type FloorDisplay, type FloorMakingCard, type FloorNextRow, getFloorDisplay } from "@/modules/production";
import { FloorClock, FloorRefresher } from "./live";

export const metadata = { title: "Floor screen" };
export const dynamic = "force-dynamic";

/**
 * Floor screen (ADR-084, docs/FLOOR_DISPLAY.md): the production TV. Outside the (app) group on purpose:
 * no menus, nothing to press. Signed in like every page (requireContext); the read model checks
 * production.batch.view at the site on the server. `?site=<code>` picks one of the caller's sites.
 *
 * Sizes are in vw so 1920 × 1080 and 1280 × 720 show the same layout (product names ≈ 44 px and big
 * numbers ≈ 64 px at 1920). Every tone has an icon and a word (never colour alone).
 */
export default async function FloorPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const code = sp.site?.trim().toUpperCase();
  const site = code ? ctx.allowedSites.find((s) => s.code.toUpperCase() === code) : ctx.currentSite;
  if (!site) return <FullMessage title="This site is not one of yours" body={`There is no site "${sp.site}" in your account. Open /floor without ?site, or ask your site manager.`} />;
  let v: FloorDisplay;
  try {
    v = await getFloorDisplay(ctx, { siteId: site.id });
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden") return <FullMessage title="This screen is not available to you" body="The floor screen needs permission to see production at this site. Ask your site manager to give this account the Floor display role." />;
    if (e instanceof DomainError && e.code === "not_found") return <FullMessage title="This site is not one of yours" body="Ask your site manager to add this account to the site." />;
    throw e;
  }
  return (
    <main className="flex h-screen w-screen flex-col gap-[0.8vw] overflow-hidden bg-[var(--bg)] p-[1vw] text-[var(--fg)]" aria-label={`Floor screen, ${v.site.name}`}>
      <header className="flex items-center justify-between rounded-[1vw] bg-[var(--brand-800)] px-[1.4vw] py-[0.6vw] text-white">
        <h1 className="font-display text-[2vw] font-semibold leading-tight">
          Bryel&apos;s Care · {v.site.name}
        </h1>
        <div className="font-display text-[2vw] font-semibold">
          <FloorClock serverNow={v.generatedAt} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.75fr_1fr] gap-[0.8vw]">
        <MakingNow m={v.makingNow} />
        <div className="grid min-h-0 grid-rows-[minmax(0,1.65fr)_minmax(0,1fr)] gap-[0.8vw]">
          <NextUp n={v.nextUp} />
          <Waiting w={v.waiting} />
        </div>
      </div>

      <TodayBar t={v.today} generatedAt={v.generatedAt} />
    </main>
  );
}

/* ------------------------------------------------------------------ panels */

/** `more` sits in the heading ("+ 2 more") so it never falls off a full panel. */
function Panel({ title, icon, more, children, className = "" }: { title: string; icon: React.ReactNode; more?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-[1vw] border border-[var(--border-strong)] bg-[var(--surface)] p-[1vw] ${className}`} aria-label={title}>
      <h2 className="mb-[0.6vw] flex items-center gap-[0.6vw] font-display text-[1.6vw] font-bold uppercase tracking-wide text-[var(--fg-2)]">
        {icon}
        {title}
        {more && <span className="ml-auto font-sans text-[1.3vw] font-semibold normal-case tracking-normal text-[var(--fg)]">{more}</span>}
      </h2>
      {children}
    </section>
  );
}

function MakingNow({ m }: { m: FloorDisplay["makingNow"] }) {
  return (
    <Panel title="Making now" icon={<Icon name="factory" />} more={m.more > 0 ? `+ ${m.more} more ${m.more === 1 ? "batch" : "batches"} being made` : null}>
      {m.cards.length === 0 ? (
        <Empty>Nothing is being made right now</Empty>
      ) : (
        <>
          {/* Up to 3 batches: one wide column (full product names); 4 to 6: two columns. */}
          <div className={`grid min-h-0 flex-1 grid-rows-3 gap-[0.7vw] ${m.cards.length > 3 ? "grid-cols-2" : "grid-cols-1"}`}>
            {m.cards.map((c) => (
              <MakingCard key={c.batchId} c={c} wide={m.cards.length <= 3} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

const TONE: Record<FloorMakingCard["tone"], { box: string; fg: string; icon: IconName }> = {
  good: { box: "border-[var(--ok-bd)] bg-[var(--surface)]", fg: "text-[var(--ok-fg)]", icon: "play" },
  wait: { box: "border-[var(--warn-bd)] bg-[var(--warn-bg)]", fg: "text-[var(--warn-fg)]", icon: "hourglass" },
  bad: { box: "border-[var(--bad-bd)] bg-[var(--bad-bg)]", fg: "text-[var(--bad-fg)]", icon: "alert" },
};

function MakingCard({ c, wide }: { c: FloorMakingCard; wide: boolean }) {
  const t = TONE[c.tone];
  const done = c.wait?.over;
  const batch = <span className="shrink-0 font-mono text-[1.15vw] font-semibold text-[var(--fg-2)]">{c.batchNumber}</span>;
  // Two columns (4–6 batches): a slightly smaller step line so "Curing until Sun 1 Nov · 2 days left" fits.
  const line = wide ? "text-[1.6vw] leading-snug" : "text-[1.35vw] leading-snug";
  return (
    <article className={`flex min-h-0 flex-col justify-between overflow-hidden rounded-[0.8vw] border-[0.2vw] px-[1vw] py-[0.7vw] ${t.box}`}>
      <div className="flex items-baseline justify-between gap-[0.8vw]">
        <h3 className="truncate font-display text-[2.3vw] font-bold leading-tight">{c.productName}</h3>
        {wide && batch}
      </div>
      {c.wait ? (
        <p className={`flex items-center gap-[0.5vw] ${line} font-semibold ${done ? "text-[var(--ok-fg)]" : t.fg}`}>
          <Icon name={done ? "check" : "hourglass"} />
          <span className="truncate">{c.wait.label}</span>
        </p>
      ) : (
        <p className={`truncate ${line} font-medium text-[var(--fg)]`}>{c.stepText}</p>
      )}
      <div className="flex items-center gap-[0.8vw]">
        <div className="h-[1.1vw] flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]" role="progressbar" aria-valuenow={Number(c.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.productName} progress`}>
          <div className={`h-full rounded-full ${c.tone === "wait" ? "bg-[var(--gold-400)]" : "bg-[var(--brand-600)]"}`} style={{ width: `${c.percent}%` }} />
        </div>
        <span className="tabular w-[5.2vw] text-right font-display text-[2vw] font-bold">{c.percent}%</span>
      </div>
      <div className="flex items-center justify-between gap-[0.8vw] whitespace-nowrap text-[1.25vw] text-[var(--fg-2)]">
        <span className={`flex shrink-0 items-center gap-[0.4vw] font-semibold ${c.tone === "good" ? "text-[var(--ok-fg)]" : t.fg}`}>
          <Icon name={done ? "check" : t.icon} />
          {c.wait ? (done ? "Ready for the next step" : "Waiting") : c.note}
        </span>
        <span className="truncate">
          {!wide && <>{batch} · </>}
          {c.assignee ? <span className="font-semibold text-[var(--fg)]">{c.assignee}</span> : "Anyone"}
          {wide && c.startedAt ? ` · started ${startedWord(c.startedAt)}` : ""}
        </span>
      </div>
    </article>
  );
}

function NextUp({ n }: { n: FloorDisplay["nextUp"] }) {
  return (
    <Panel title="Next up" icon={<Icon name="list" />} more={n.more > 0 ? `+ ${n.more} more` : null}>
      {n.rows.length === 0 ? (
        <Empty>No orders waiting</Empty>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col justify-start gap-[0.2vw] overflow-hidden">
          {n.rows.map((r, i) => (
            <NextRow key={r.workOrderId} r={r} i={i + 1} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function NextRow({ r, i }: { r: FloorNextRow; i: number }) {
  return (
    <li className={`flex items-start gap-[0.7vw] rounded-[0.6vw] px-[0.6vw] py-[0.2vw] ${r.late ? "bg-[var(--bad-bg)]" : ""}`}>
      <span className="tabular w-[2vw] shrink-0 font-display text-[1.6vw] font-bold leading-tight text-[var(--fg-2)]">{i}.</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[1.6vw] font-bold leading-tight">{r.productName}</div>
        <div className="flex items-center gap-x-[0.5vw] whitespace-nowrap text-[1.15vw] leading-snug">
          <span className="shrink-0 font-semibold">{r.piecesText}</span>
          <span className="min-w-0 truncate text-[var(--fg-2)]">· {r.neededByText}</span>
          {r.late && (
            <span className="inline-flex shrink-0 items-center gap-[0.3vw] rounded-full border-2 border-[var(--bad-bd)] bg-[var(--surface)] px-[0.5vw] font-bold text-[var(--bad-fg)]">
              <Icon name="alert" /> Late
            </span>
          )}
          {r.missingMaterials && (
            <span className="inline-flex shrink-0 items-center gap-[0.3vw] rounded-full border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)] px-[0.5vw] font-bold text-[var(--warn-fg)]">
              <Icon name="box" /> Missing materials
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function Waiting({ w }: { w: FloorDisplay["waiting"] }) {
  const nothing = w.curing + w.curingDone + w.qualityCheck + w.missingMaterials === 0;
  return (
    <Panel title="Waiting" icon={<Icon name="hourglass" />}>
      {nothing ? (
        <Empty>Nothing is waiting</Empty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col justify-around">
          <WaitRow n={w.curing} icon="hourglass" tone="wait" words={w.curing === 1 ? "batch curing or resting" : "batches curing or resting"} sub={w.curingDone ? `${w.curingDone} finished — ready for the next step` : null} />
          <WaitRow n={w.qualityCheck} icon="search" tone="wait" words="Waiting for the quality check" sub={w.qualityCheckOldestText ? `oldest waiting ${w.qualityCheckOldestText}` : null} />
          <WaitRow n={w.missingMaterials} icon="alert" tone="bad" words={w.missingMaterials === 1 ? "order missing materials" : "orders missing materials"} sub={null} />
        </ul>
      )}
    </Panel>
  );
}

function WaitRow({ n, icon, tone, words, sub }: { n: number; icon: IconName; tone: "wait" | "bad"; words: string; sub: string | null }) {
  const fg = n === 0 ? "text-[var(--fg-muted)]" : tone === "bad" ? "text-[var(--bad-fg)]" : "text-[var(--warn-fg)]";
  return (
    <li className="flex items-center gap-[0.9vw]">
      <span className={`${fg} text-[2.4vw]`}>
        <Icon name={n === 0 ? "check" : icon} />
      </span>
      <span className={`tabular w-[4.4vw] text-right font-display text-[3.3vw] font-bold leading-none ${fg}`}>{n}</span>
      <span className="min-w-0">
        <span className="block text-[1.45vw] font-semibold leading-tight">{words}</span>
        {sub && <span className="block text-[1.15vw] text-[var(--fg-2)]">{sub}</span>}
      </span>
    </li>
  );
}

function TodayBar({ t, generatedAt }: { t: FloorDisplay["today"]; generatedAt: string }) {
  const n = (x: string) => new Decimal(x).toNumber().toLocaleString("en-PH", { maximumFractionDigits: 0 });
  return (
    <footer className="flex items-center gap-[1.6vw] rounded-[1vw] border border-[var(--border-strong)] bg-[var(--surface)] px-[1.4vw] py-[0.6vw]" aria-label="Today">
      <h2 className="font-display text-[1.6vw] font-bold uppercase tracking-wide text-[var(--fg-2)]">Today</h2>
      {t ? (
        <>
          <div className="flex items-baseline gap-[0.6vw]">
            <span className="text-[1.4vw] font-semibold">Made today</span>
            <span className="tabular font-display text-[3.3vw] font-bold leading-none text-[var(--ok-fg)]">{n(t.made)}</span>
            {t.planned && <span className="text-[1.4vw] text-[var(--fg-2)]">of {n(t.planned)} planned</span>}
          </div>
          {t.planned && t.percentOfPlan !== null ? (
            <div className="flex flex-1 items-center gap-[0.8vw]">
              <div className="h-[1.4vw] flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]" role="progressbar" aria-valuenow={Number(t.percentOfPlan)} aria-valuemin={0} aria-valuemax={100} aria-label="Made today of planned">
                <div className="h-full rounded-full bg-[var(--brand-600)]" style={{ width: `${t.percentOfPlan}%` }} />
              </div>
              <span className="tabular font-display text-[1.8vw] font-bold">{t.percentOfPlan}%</span>
            </div>
          ) : (
            <div className="flex-1 text-[1.3vw] text-[var(--fg-2)]">{t.made === "0" ? "Nothing logged yet today" : ""}</div>
          )}
          <div className="flex items-baseline gap-[0.6vw]">
            <span className={`text-[1.4vw] font-semibold ${t.rejects !== "0" ? "text-[var(--bad-fg)]" : ""}`}>Rejects today</span>
            <span className={`tabular font-display text-[3.3vw] font-bold leading-none ${t.rejects !== "0" ? "text-[var(--bad-fg)]" : "text-[var(--fg-muted)]"}`}>{n(t.rejects)}</span>
            {t.rejectPct && <span className="text-[1.4vw] text-[var(--fg-2)]">({t.rejectPct}%)</span>}
          </div>
        </>
      ) : (
        <div className="flex-1 text-[1.3vw] text-[var(--fg-2)]">Today&apos;s numbers need access to the daily log.</div>
      )}
      <div className="ml-auto shrink-0 text-[1.1vw] text-[var(--fg-2)]">
        <FloorRefresher generatedAt={generatedAt} />
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ bits */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-[0.8vw] text-center text-[2vw] font-semibold text-[var(--fg-2)]">
      <Icon name="check" />
      {children}
    </div>
  );
}

function FullMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-[1.5vw] bg-[var(--bg)] p-[4vw] text-center text-[var(--fg)]">
      <h1 className="font-display text-[3vw] font-bold">{title}</h1>
      <p className="max-w-[60vw] text-[1.8vw] text-[var(--fg-2)]">{body}</p>
    </main>
  );
}

const MANILA = "Asia/Manila";
function startedWord(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: MANILA });
  if (day(d) === day(new Date())) return d.toLocaleTimeString("en-GB", { timeZone: MANILA, hour: "2-digit", minute: "2-digit" });
  return new Intl.DateTimeFormat("en-GB", { timeZone: MANILA, weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
}

type IconName = "factory" | "list" | "hourglass" | "search" | "alert" | "check" | "play" | "box";
const PATHS: Record<IconName, string> = {
  factory: "M3 21V9l6 4V9l6 4V5h6v16H3zM7 17h2M12 17h2M17 17h2",
  list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  hourglass: "M6 2h12M6 22h12M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5",
  alert: "M12 3l10 18H2L12 3zM12 10v5M12 18h.01",
  check: "M4 12l5 5L20 6",
  play: "M7 4l13 8-13 8V4z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10",
};
function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
