import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type FloorDisplay, type FloorMakingCard, type FloorNextRow, getFloorDisplay } from "@/modules/production";
import { FloorClock, FloorPages, FloorRefresher } from "./live";
import "./floor.css";

export const metadata = { title: "Floor screen" };
export const dynamic = "force-dynamic";

/** ADR-135: three batch cards and three orders per page; more rotate every 12 s (the read model caps them at 6 and 5). */
const CARDS_PER_PAGE = 3;
const NEXT_PER_PAGE = 3;
/** At most this many problems in the strip at the top; the rest are counted ("+ 2 more"). */
const MAX_ALERTS = 3;

/**
 * Floor screen (ADR-084, redesigned by ADR-135; docs/FLOOR_DISPLAY.md): the production TV. Outside the (app) group on
 * purpose: no menus, nothing to press. Signed in like every page (requireContext); the read model checks
 * production.batch.view at the site on the server. `?site=<code>` picks one of the caller's sites; `?theme=dark` gives
 * the dark background (bright rooms, less glare).
 *
 * Calm layout readable from 4–5 m: header (site, clock, Live / No internet), problems only when there are any, the
 * batches being made as cards (status word + icon + colour, progress bar, step, who), Next up, Waiting, Today. Sizes
 * follow one unit (floor.css) so 1280 × 720 to 3840 × 2160 show the same picture; more items than fit rotate.
 */
export default async function FloorPage({ searchParams }: { searchParams: Promise<{ site?: string; theme?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const theme = sp.theme === "dark" ? "dark" : "light";
  const code = sp.site?.trim().toUpperCase();
  const site = code ? ctx.allowedSites.find((s) => s.code.toUpperCase() === code) : ctx.currentSite;
  if (!site) return <FullMessage theme={theme} title="This site is not one of yours" body={`There is no site "${sp.site}" in your account. Open /floor without ?site, or ask your site manager.`} />;
  let v: FloorDisplay;
  try {
    v = await getFloorDisplay(ctx, { siteId: site.id });
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden") return <FullMessage theme={theme} title="This screen is not available to you" body="The floor screen needs permission to see production at this site. Ask your site manager to give this account the Floor display role." />;
    if (e instanceof DomainError && e.code === "not_found") return <FullMessage theme={theme} title="This site is not one of yours" body="Ask your site manager to add this account to the site." />;
    throw e;
  }
  const nothingToday = v.makingNow.cards.length === 0 && v.nextUp.rows.length === 0;
  return (
    <main className="tv" data-tv-theme={theme} aria-label={`Floor screen, ${v.site.name}`} data-testid="floor-screen">
      <header className="tv-header">
        <div className="tv-brand">
          <span className="tv-mark tv-l" aria-hidden>
            <Icon name="leaf" />
          </span>
          <div className="min-w-0">
            <h1 className="tv-l truncate font-display font-bold">{v.site.name}</h1>
            {/* ADR-088: the one sentence that says what this screen is for (TV size). */}
            <p className="tv-xs truncate text-[var(--fg-2)]">This screen is for everyone on the floor: what we make now, what is next, what waits.</p>
          </div>
        </div>
        <FloorRefresher generatedAt={v.generatedAt} />
        <div className="tv-clock">
          <FloorClock serverNow={v.generatedAt} />
        </div>
      </header>

      <Alerts v={v} />

      {nothingToday ? (
        <section className="tv-panel flex-1" aria-label="Today">
          <div className="tv-empty" data-testid="floor-empty">
            <span className="tv-empty-icon tv-xxl">
              <Icon name="check" />
            </span>
            <p className="tv-l font-display font-bold text-[var(--fg)]">No batches today</p>
            <p className="tv-m">Nothing is being made and no order is waiting to start. This screen updates by itself.</p>
          </div>
        </section>
      ) : (
        <div className="tv-body">
          <MakingNow m={v.makingNow} />
          <div className="tv-col">
            <NextUp n={v.nextUp} />
            <Waiting w={v.waiting} />
          </div>
        </div>
      )}

      <TodayBar t={v.today} />
    </main>
  );
}

/* ------------------------------------------------------------------ problems (only when there are any) */

function Alerts({ v }: { v: FloorDisplay }) {
  const late = v.nextUp.rows.filter((r) => r.late);
  const items: { key: string; icon: IconName; text: string }[] = [
    ...v.makingNow.cards.filter((c) => c.tone === "bad").map((c) => ({ key: c.batchId, icon: "alert" as const, text: `${c.productName}: ${c.note}` })),
    // Late orders are one line: "Late: Guava Bar Soap 135 g (needed by Wed 11 Nov)" or "2 orders are late: A, B".
    ...(late.length === 1
      ? [{ key: "late", icon: "clock" as const, text: `Late: ${late[0].productName} (${late[0].neededByText.replace(/^Needed/, "needed")})` }]
      : late.length > 1
        ? [{ key: "late", icon: "clock" as const, text: `${late.length} orders are late: ${late.map((r) => r.productName).join(", ")}` }]
        : []),
    ...(v.waiting.missingMaterials > 0
      ? [{ key: "missing", icon: "box" as const, text: `${v.waiting.missingMaterials} ${v.waiting.missingMaterials === 1 ? "order cannot start: materials missing" : "orders cannot start: materials missing"}` }]
      : []),
  ];
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_ALERTS);
  return (
    <section className="tv-alerts tv-m" role="alert" aria-label="Needs attention" data-testid="floor-alerts">
      <span className="inline-flex shrink-0 items-center gap-[0.4em] font-display font-bold uppercase">
        <Icon name="alert" /> Needs attention
      </span>
      <ul className="font-semibold">
        {shown.map((a) => (
          <li key={a.key}>
            <Icon name={a.icon} />
            <span className="truncate">{a.text}</span>
          </li>
        ))}
      </ul>
      {items.length > shown.length && <span className="shrink-0 font-semibold">+ {items.length - shown.length} more</span>}
    </section>
  );
}

/* ------------------------------------------------------------------ panels */

function Panel({ title, icon, more, children, className = "", testId }: { title: string; icon: IconName; more?: string | null; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`tv-panel ${className}`} aria-label={title} data-testid={testId}>
      <h2 className="tv-panel-head tv-s font-display">
        <Icon name={icon} />
        {title}
        {more && <span className="tv-more tv-xs font-sans">{more}</span>}
      </h2>
      {children}
    </section>
  );
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function MakingNow({ m }: { m: FloorDisplay["makingNow"] }) {
  return (
    <Panel title="Making now" icon="factory" className="flex-1" testId="floor-making" more={m.more > 0 ? `+ ${m.more} more ${m.more === 1 ? "batch" : "batches"} being made` : null}>
      {m.cards.length === 0 ? (
        <Empty title="Nothing is being made right now" sub="The next order is on the right." />
      ) : (
        <FloorPages
          label="Making now"
          pages={chunk(m.cards, CARDS_PER_PAGE).map((page) => (
            <div key={page[0].batchId} className="tv-cards">
              {page.map((c) => (
                <MakingCard key={c.batchId} c={c} />
              ))}
            </div>
          ))}
        />
      )}
    </Panel>
  );
}

/** The status word with its icon: never colour alone. */
function statusOf(c: FloorMakingCard): { word: string; icon: IconName; cls: string } {
  if (c.wait) return c.wait.over ? { word: "Ready for the next step", icon: "check", cls: "tv-ok" } : { word: "Waiting", icon: "hourglass", cls: "tv-warn" };
  if (c.tone === "bad") return { word: c.note, icon: "alert", cls: "tv-bad" };
  if (c.tone === "wait") return { word: c.note, icon: "hourglass", cls: "tv-warn" };
  return { word: c.note, icon: c.note === "Being made" ? "play" : "check", cls: "tv-ok" };
}

function MakingCard({ c }: { c: FloorMakingCard }) {
  const s = statusOf(c);
  const barTone = c.wait && !c.wait.over ? "wait" : c.tone;
  return (
    <article className="tv-card" data-tone={barTone} data-testid="floor-card">
      <div className="tv-row">
        <h3 className="tv-l min-w-0 flex-1 truncate font-display font-bold">{c.productName}</h3>
        {c.dayLabel && (
          <span className="tv-pill tv-quiet tv-xs shrink-0" data-testid="floor-day">
            <Icon name="calendar" /> {c.dayLabel}
          </span>
        )}
        <span className="tv-mono tv-xs shrink-0">{c.batchNumber}</span>
      </div>
      <div className="tv-row">
        <p className="tv-m min-w-0 flex-1 truncate font-medium">{c.wait ? c.wait.label : c.stepText}</p>
        <span className="tv-s flex min-w-0 shrink-0 items-center gap-[0.4em] whitespace-nowrap text-[var(--fg-2)]">
          <Icon name="user" />
          {c.assignee ? <b className="font-semibold text-[var(--fg)]">{c.assignee}</b> : "Anyone"}
          {c.startedAt ? ` · started ${startedWord(c.startedAt)}` : ""}
        </span>
      </div>
      <div className="tv-row">
        <span className={`tv-pill tv-xs ${s.cls} min-w-0 max-w-[45%]`}>
          <Icon name={s.icon} />
          <span className="truncate">{s.word}</span>
        </span>
        <div className="tv-bar" data-tone={barTone} role="progressbar" aria-valuenow={Number(c.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.productName}: ${c.percent}% of the steps done`}>
          <div style={{ width: `${c.percent}%` }} />
        </div>
        <span className="tv-pct tabular w-[3.3em] shrink-0 text-right font-display font-bold">{c.percent}%</span>
      </div>
    </article>
  );
}

function NextUp({ n }: { n: FloorDisplay["nextUp"] }) {
  return (
    <Panel title="Next up" icon="list" className="flex-1" testId="floor-next" more={n.more > 0 ? `+ ${n.more} more` : null}>
      {n.rows.length === 0 ? (
        <Empty title="No orders waiting to start" />
      ) : (
        <FloorPages
          label="Next up"
          pages={chunk(n.rows, NEXT_PER_PAGE).map((page, p) => (
            <ol key={page[0].workOrderId} className="tv-next">
              {page.map((r, i) => (
                <NextRow key={r.workOrderId} r={r} i={p * NEXT_PER_PAGE + i + 1} />
              ))}
            </ol>
          ))}
        />
      )}
    </Panel>
  );
}

function NextRow({ r, i }: { r: FloorNextRow; i: number }) {
  return (
    <li>
      <span className="tv-num tv-m tabular font-display">{i}</span>
      <div className="min-w-0 flex-1">
        <div className="tv-m truncate font-display font-bold">{r.productName}</div>
        <div className="tv-xs flex min-w-0 items-center gap-[0.5em] whitespace-nowrap text-[var(--fg-2)]">
          <span className="shrink-0 font-semibold text-[var(--fg)]">{r.piecesText}</span>
          <span className="min-w-0 truncate">· {r.neededByText}</span>
        </div>
      </div>
      {(r.late || r.missingMaterials) && (
        <div className="flex shrink-0 flex-col items-end gap-[0.2em]">
          {r.late && (
            <span className="tv-pill tv-bad tv-xs">
              <Icon name="clock" /> Late
            </span>
          )}
          {r.missingMaterials && (
            <span className="tv-pill tv-warn tv-xs">
              <Icon name="box" /> Missing materials
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function Waiting({ w }: { w: FloorDisplay["waiting"] }) {
  return (
    <Panel title="Waiting" icon="hourglass" testId="floor-waiting">
      <ul className="tv-tiles">
        <Tile n={w.curing} icon="hourglass" tone="tv-warn" words={w.curing === 1 ? "batch curing or resting" : "batches curing or resting"} sub={w.curingDone ? `${w.curingDone} finished, ready for the next step` : null} />
        <Tile n={w.qualityCheck} icon="search" tone="tv-warn" words="waiting for the quality check" sub={w.qualityCheckOldestText ? `oldest waiting ${w.qualityCheckOldestText}` : null} />
        <Tile n={w.missingMaterials} icon="box" tone="tv-bad" words={w.missingMaterials === 1 ? "order missing materials" : "orders missing materials"} sub={null} />
      </ul>
    </Panel>
  );
}

/** One waiting line: icon + number + words (a zero is grey with a tick: nothing waits there). */
function Tile({ n, icon, tone, words, sub }: { n: number; icon: IconName; tone: "tv-warn" | "tv-bad"; words: string; sub: string | null }) {
  const on = n > 0;
  return (
    <li className={`tv-tile ${on ? tone : ""}`} data-on={on}>
      <span className={`tv-m ${on ? "" : "text-[var(--fg-2)]"}`}>
        <Icon name={on ? icon : "check"} />
      </span>
      <span className={`tv-l tabular w-[1.6em] shrink-0 text-right font-display font-bold ${on ? "" : "text-[var(--fg-2)]"}`}>{n}</span>
      <span className="min-w-0 flex-1">
        <span className="tv-s block truncate font-semibold">{words}</span>
        {sub && <span className="tv-xs block truncate">{sub}</span>}
      </span>
    </li>
  );
}

function TodayBar({ t }: { t: FloorDisplay["today"] }) {
  const n = (x: string) => new Decimal(x).toNumber().toLocaleString("en-PH", { maximumFractionDigits: 0 });
  return (
    <footer className="tv-footer" aria-label="Today" data-testid="floor-today">
      <h2 className="tv-s shrink-0 font-display font-bold uppercase tracking-wide text-[var(--fg-2)]">Today</h2>
      {t ? (
        <>
          <div className="flex shrink-0 items-baseline gap-[0.4em]">
            <span className="tv-s font-semibold">Made</span>
            <span className="tv-xl tabular font-display font-bold text-[var(--ok-fg)]">{n(t.made)}</span>
            {t.planned && <span className="tv-s text-[var(--fg-2)]">of {n(t.planned)} planned</span>}
          </div>
          {t.planned && t.percentOfPlan !== null ? (
            <div className="tv-row flex-1">
              <div className="tv-bar" role="progressbar" aria-valuenow={Number(t.percentOfPlan)} aria-valuemin={0} aria-valuemax={100} aria-label="Made today of planned">
                <div style={{ width: `${t.percentOfPlan}%` }} />
              </div>
              <span className="tv-m tabular font-display font-bold">{t.percentOfPlan}%</span>
            </div>
          ) : (
            <div className="tv-s flex-1 text-[var(--fg-2)]">{t.made === "0" ? "Nothing logged yet today" : ""}</div>
          )}
          <div className={`flex shrink-0 items-baseline gap-[0.4em] ${t.rejects !== "0" ? "text-[var(--bad-fg)]" : ""}`}>
            {t.rejects !== "0" && (
              <span className="tv-s self-center">
                <Icon name="alert" />
              </span>
            )}
            <span className="tv-s font-semibold">Rejects</span>
            <span className={`tv-xl tabular font-display font-bold ${t.rejects !== "0" ? "" : "text-[var(--fg-2)]"}`}>{n(t.rejects)}</span>
            {t.rejectPct && <span className="tv-s">({t.rejectPct}%)</span>}
          </div>
        </>
      ) : (
        <div className="tv-s flex-1 text-[var(--fg-2)]">Today&apos;s numbers need access to the daily log.</div>
      )}
    </footer>
  );
}

/* ------------------------------------------------------------------ bits */

function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="tv-empty">
      <span className="tv-empty-icon tv-xl">
        <Icon name="check" />
      </span>
      <p className="tv-m font-semibold text-[var(--fg)]">{title}</p>
      {sub && <p className="tv-s">{sub}</p>}
    </div>
  );
}

function FullMessage({ title, body, theme }: { title: string; body: string; theme: "light" | "dark" }) {
  return (
    <main className="tv items-center justify-center text-center" data-tv-theme={theme}>
      <h1 className="tv-xl font-display font-bold">{title}</h1>
      <p className="tv-m max-w-[60vw] text-[var(--fg-2)]">{body}</p>
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

type IconName = "factory" | "list" | "hourglass" | "search" | "alert" | "check" | "play" | "box" | "user" | "clock" | "calendar" | "leaf";
const PATHS: Record<IconName, string> = {
  factory: "M3 21V9l6 4V9l6 4V5h6v16H3zM7 17h2M12 17h2M17 17h2",
  list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  hourglass: "M6 2h12M6 22h12M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5",
  alert: "M12 3l10 18H2L12 3zM12 10v5M12 18h.01",
  check: "M4 12l5 5L20 6",
  play: "M7 4l13 8-13 8V4z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  leaf: "M5 19c0-8 5-14 15-15 0 10-6 15-14 15M5 19c3-4 6-6 9-8",
};
function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[1.05em] w-[1.05em] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
