import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listTakeouts, PURPOSE_WORDS, takeoutChannels, type TakeoutPurpose } from "@/modules/inventory";
import { db } from "@/db/client";
import { buttonClass, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { CellCode, CellMeta, DataTable, ListToolbar, Panel, TableFooter, Tabs, ToolbarSearch, type Column } from "@/ui/kit";
import { FilterSelect } from "@/ui/kit-client";
import { MoreMenu } from "@/ui/more-menu";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Taken out" };
export const dynamic = "force-dynamic";

type Sp = { from?: string; to?: string; purpose?: string; channel?: string; person?: string; status?: string; q?: string };
type Entry = Awaited<ReturnType<typeof listTakeouts>>["entries"][number];

const TONE: Record<string, "ok" | "warn" | "neu" | "bad"> = { posted: "ok", awaiting_approval: "warn", reversed: "neu", rejected: "bad", cancelled: "neu" };

const COLUMNS: Column<Entry>[] = [
  { key: "what", header: "What", primary: true, cell: (r) => <>{r.products}<CellMeta>{r.sentence}</CellMeta></> },
  { key: "pieces", header: "Pieces", align: "right", cell: (r) => <span className="tabular-nums">{r.pieces}</span> },
  { key: "day", header: "Day", cell: (r) => fmtDate(r.day) },
  { key: "who", header: "Person", hideBelow: "md", cell: (r) => r.personName },
  { key: "state", header: "State", cell: (r) => <Chip tone={TONE[r.status] ?? "neu"}>{r.statusWord}</Chip> },
  { key: "number", header: "Number", hideBelow: "lg", cell: (r) => <CellCode>{r.number}</CellCode> },
];

/**
 * Taken out (ADR-138 §3): every take-out at the site for a period (default the last 7 days), with totals by product,
 * reason or online shop, person and day (posted only; undone and refused entries are listed with their state). Pieces
 * only: product costs are not recorded yet, so there is no money column (A-TAKE-04).
 */
export default async function TakenOutPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.takeout.view")) return <Forbidden what="the list of pieces taken out" permission="inventory.takeout.view" />;
  const sp = await searchParams;
  const status = sp.status === "awaiting_approval" || sp.status === "reversed" ? sp.status : "";
  const list = await listTakeouts(ctx, { from: sp.from, to: sp.to, purpose: sp.purpose || undefined, channel: sp.channel || undefined, personId: sp.person || undefined, status: status || undefined, q: sp.q });
  const all = status ? await listTakeouts(ctx, { from: sp.from, to: sp.to, purpose: sp.purpose || undefined, channel: sp.channel || undefined, personId: sp.person || undefined, q: sp.q }) : list;
  const channels = await takeoutChannels(db, ctx.organizationId);
  const f = list.filter;
  const href = (over: Partial<Sp>) => {
    const p = new URLSearchParams();
    const cur: Sp = { from: f.from, to: f.to, purpose: sp.purpose, channel: sp.channel, person: sp.person, status: status || undefined, q: sp.q };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v);
    return `/inventory/take-outs?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(Object.entries({ from: f.from, to: f.to, purpose: sp.purpose ?? "", channel: sp.channel ?? "", personId: sp.person ?? "", status, q: sp.q ?? "" }).filter(([, v]) => v)).toString();
  const days = (n: number) => {
    const t = new Date(`${f.to}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Taken out"
        subtitle={`${ctx.currentSite.name} · ${fmtDate(f.from)} – ${fmtDate(f.to)} · ${list.totals.pieces} pieces`}
        actions={
          <>
            {ctx.can("inventory.takeout.create") && <LinkButton href="/inventory/take-out" variant="cta">Take a few out</LinkButton>}
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <Help screen="inventory.takeout" />
                <LinkButton href="/inventory/take-out/count" variant="secondary">Count what&apos;s left</LinkButton>
                {ctx.can("inventory.takeout.export") && (
                  <>
                    <a className={buttonClass("secondary")} href={`/api/v1/inventory/takeouts/export?${exportQs}&format=xlsx`}>Download for Excel</a>
                    <a className={buttonClass("secondary")} href={`/api/v1/inventory/takeouts/export?${exportQs}&format=csv`}>Download as CSV</a>
                  </>
                )}
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for the pieces that left without a customer order: online shop orders, samples, gifts, display and staff use. It shows who took what, when and why. Money from online shops is kept outside the app for now.</PageIntro>
      <ListToolbar
        tabs={
          <Tabs
            bare
            label="Filter by state"
            active={status}
            items={[
              { key: "", label: "All", href: href({ status: undefined }), count: all.counts.all },
              { key: "awaiting_approval", label: "Waiting for OK", href: href({ status: "awaiting_approval" }), count: all.counts.waiting },
              { key: "reversed", label: "Undone", href: href({ status: "reversed" }) },
            ]}
          />
        }
      >
        <ToolbarSearch action="/inventory/take-outs" keep={{ from: f.from, to: f.to, status: status || undefined, purpose: sp.purpose, channel: sp.channel, person: sp.person }} defaultValue={sp.q ?? ""} placeholder="Product, lot, shop order, customer" label="Search take-outs" clearHref={href({ q: undefined })} />
        <FilterSelect
          id="period"
          label="Period"
          value={f.from === days(0) ? "1" : f.from === days(6) ? "7" : f.from === days(29) ? "30" : "x"}
          options={[
            { value: "1", label: "Today", href: href({ from: days(0) }) },
            { value: "7", label: "Last 7 days", href: href({ from: days(6) }) },
            { value: "30", label: "Last 30 days", href: href({ from: days(29) }) },
            ...(f.from !== days(0) && f.from !== days(6) && f.from !== days(29) ? [{ value: "x", label: `${fmtDate(f.from)} – ${fmtDate(f.to)}`, href: href({}) }] : []),
          ]}
        />
        <FilterSelect
          id="why"
          label="Why"
          value={sp.channel ? `ch:${sp.channel}` : (sp.purpose ?? "")}
          options={[
            { value: "", label: "Every reason", href: href({ purpose: undefined, channel: undefined }) },
            ...(Object.keys(PURPOSE_WORDS) as TakeoutPurpose[]).map((p) => ({ value: p, label: PURPOSE_WORDS[p].label, href: href({ purpose: p, channel: undefined }) })),
            ...channels.map((c) => ({ value: `ch:${c.code}`, label: `Sold online · ${c.label}`, href: href({ purpose: "sold_online", channel: c.code }) })),
          ]}
        />
        {list.people.length > 1 || sp.person ? (
          <FilterSelect id="person" label="Person" value={sp.person ?? ""} options={[{ value: "", label: "Everyone", href: href({ person: undefined }) }, ...all.people.map((p) => ({ value: p.id, label: p.name, href: href({ person: p.id }) }))]} />
        ) : null}
      </ListToolbar>
      {list.entries.length === 0 ? (
        <EmptyState title={status || sp.q || sp.purpose || sp.person ? "Nothing matches" : "Nothing taken out in this period"} action={ctx.can("inventory.takeout.create") ? <LinkButton href="/inventory/take-out" variant="secondary">Take a few out</LinkButton> : undefined}>
          Pieces taken out for online orders, samples, gifts, display or staff show here with who took them and why.
        </EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <DataTable
            label="Take-outs"
            testId="takeouts"
            rows={list.entries}
            columns={COLUMNS}
            rowKey={(r) => r.id}
            rowHref={(r) => `/inventory/take-outs/${r.id}`}
            rowTone={(r) => (r.status === "awaiting_approval" ? "warn" : null)}
            minWidth={560}
            footer={<TableFooter count={list.entries.length} noun={["take-out", "take-outs"]} note={list.entries.length >= 2000 ? "the newest 2,000 lines; choose a shorter period" : undefined} />}
          />
          <div className="space-y-4" data-testid="takeout-totals">
            <Totals title="By product" rows={list.totals.byProduct} />
            <Totals title="By reason or shop" rows={list.totals.byReason} />
            <Totals title="By person" rows={list.totals.byPerson} />
            <Totals title="By day" rows={list.totals.byDay.map((d) => ({ ...d, label: fmtDate(d.label) }))} />
            <p className="text-[12px] text-muted">Totals count pieces that went out (not undone, not waiting). No money value: product costs are not in the app yet.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Totals({ title, rows }: { title: string; rows: { label: string; pieces: string; entries: number }[] }) {
  return (
    <Panel title={title} flush>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted">Nothing yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.label} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{r.label}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.pieces} pcs</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
