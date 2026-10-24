import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type KpiRecords, RECORD_LIMIT, canSeeCrossSite, getKpiRecords } from "@/modules/analytics";
import { Card, Dl, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Banner } from "@/ui/status";
import { fmtKpi, hhmm } from "@/ui/charts/format";
import { CategoryChip, RecordRef, ValueLabelChip, rangeText } from "../../kpi-ui";

export const dynamic = "force-dynamic";

const AGG_TEXT: Record<string, string> = {
  sum: "Total of the records",
  ratio: "Σ numerator ÷ Σ denominator of the records",
  median: "Median of the record values (lower middle value for an even count)",
  p90: "90th percentile of the record values",
  max: "Largest record value",
};

function totalLine(r: KpiRecords) {
  const v = fmtKpi(r.def.unit, r.total.value);
  if (r.def.aggregate === "ratio") return `${v} = ${r.total.numerator} ÷ ${r.total.denominator}`;
  return v;
}

/**
 * The records behind a KPI value (W11-02): the KPI's record query for the scope and period, so the
 * list is what the number was made of; the total row equals the card.
 */
export default async function KpiRecordsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ scope?: string; period?: string; from?: string; to?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  let r: KpiRecords;
  try {
    r = await getKpiRecords(ctx, decodeURIComponent(code), { scope: sp.scope ?? null, period: sp.period ?? null, from: sp.from ?? null, to: sp.to ?? null });
  } catch (e) {
    if (e instanceof DomainError && ["forbidden", "not_found", "validation"].includes(e.code))
      return (
        <>
          <PageHeader title="KPI records" />
          <EmptyState title={e.code === "forbidden" ? "You don't have access to this figure" : e.code === "validation" ? "Check the period" : "This figure isn't available at your sites"} action={<Link href="/dashboard" className="font-medium text-primary-text hover:underline">Back to the overview</Link>}>
            {e.message}
          </EmptyState>
        </>
      );
    throw e;
  }
  const showSite = r.scope.all;
  const valueHeader = r.def.aggregate === "ratio" ? "Counts as" : "Value";
  const val = (row: KpiRecords["rows"][number]) =>
    r.def.aggregate === "ratio" ? `${row.num ?? "0"} of ${row.den ?? "0"}` : row.num === null ? "—" : fmtKpi(r.def.unit === "count" ? "count" : r.def.unit, row.num);
  const scopeOther = r.scope.all ? null : r.scope.siteIds[0];
  return (
    <>
      <PageHeader
        title={r.def.name}
        subtitle={`${r.def.code} · ${r.scope.label} · ${r.def.kind === "asof" ? `as of ${new Date(r.period.asOf).toLocaleString("en-GB", { timeZone: "Asia/Manila", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : rangeText(r.period.fromDate, r.period.toDate)}`}
        actions={
          canSeeCrossSite(ctx) && scopeOther ? (
            <Link href={`?${new URLSearchParams({ ...sp, scope: "all" } as Record<string, string>).toString()}`} className="text-[13px] font-medium text-primary-text hover:underline">
              Show all sites
            </Link>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {r.lastCheck?.status === "mismatch" && (
          <Banner tone="bad" title="The last nightly check found a difference for this KPI">
            {r.lastCheck.detail} The figures below are recomputed from the records now; the stored snapshot keeps what was reported.
          </Banner>
        )}
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="tabular font-display text-[30px] font-semibold text-fg">{totalLine(r)}</p>
            <ValueLabelChip label={r.def.label} />
          </div>
          <p className="mt-1 text-[13px] text-fg-2">{r.def.definition}</p>
          <div className="mt-4">
            <Dl
              items={[
                ["Calculation", `${r.def.formula}. ${AGG_TEXT[r.def.aggregate]}.`],
                ["Time basis", r.def.timeBasis],
                ["Sources", r.def.sources.join(", ")],
                ["Refresh", r.def.refresh === "night" ? "Nightly" : "Computed from posted records when the page opens"],
                ["Records", `${r.total.rowCount}${r.truncated ? ` (first ${RECORD_LIMIT} shown)` : ""}`],
                ["Definition", r.version ? `Version ${r.version.versionNo} since ${new Date(r.version.effectiveFrom).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Manila" })}` : "Not yet recorded (first nightly snapshot)"],
                ["Last nightly check", r.lastCheck ? `${r.lastCheck.status === "match" ? "Matched its source records" : "Difference found"} · ${new Date(r.lastCheck.checkedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Manila" })} ${hhmm(r.lastCheck.checkedAt)}` : "Not checked yet"],
              ]}
            />
          </div>
        </Card>
        {r.rows.length === 0 ? (
          <EmptyState title="No records in this scope and period">The value is {fmtKpi(r.def.unit, r.total.value)}{r.total.value === null ? " because there is nothing to divide by" : ""}.</EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table head={["Record", ...(showSite ? ["Site"] : []), "Item", "Detail", "Date", valueHeader, "Category"]}>
                {r.rows.map((row, i) => (
                  <tr key={`${row.refId}-${i}`} className="hover:bg-surface-2">
                    <Td>
                      <RecordRef r={row} />
                    </Td>
                    {showSite && <Td className="text-[12px] font-semibold text-muted">{row.siteCode ?? "Org"}</Td>}
                    <Td>{row.item}</Td>
                    <Td className="text-[12.5px] text-fg-2">{row.detail}</Td>
                    <Td className="whitespace-nowrap text-[12.5px]">{row.at ? new Date(row.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Manila" }) : "—"}</Td>
                    <Td className="whitespace-nowrap text-right tabular">{val(row)}</Td>
                    <Td>
                      <CategoryChip category={row.category} />
                    </Td>
                  </tr>
                ))}
                <tr className="bg-surface-2 font-semibold">
                  <Td>Total</Td>
                  {showSite && <Td />}
                  <Td />
                  <Td />
                  <Td />
                  <Td className="whitespace-nowrap text-right tabular">{totalLine(r)}</Td>
                  <Td />
                </tr>
              </Table>
            </div>
            <ul className="flex flex-col gap-2 md:hidden">
              {r.rows.map((row, i) => (
                <li key={`${row.refId}-${i}`} className="rounded-[12px] border border-line bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <RecordRef r={row} />
                    <CategoryChip category={row.category} />
                  </div>
                  {row.item && <p className="mt-1 text-[14px] font-medium text-fg">{row.item}</p>}
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {row.detail} · {val(row)}
                    {showSite && ` · ${row.siteCode ?? "Org"}`}
                  </p>
                </li>
              ))}
              <li className="rounded-[12px] bg-surface-2 p-3 text-[13px] font-semibold">Total {totalLine(r)}</li>
            </ul>
          </>
        )}
      </div>
    </>
  );
}
