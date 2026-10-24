import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listKpiDefinitions } from "@/modules/analytics";
import { Card, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { LABEL_TEXT } from "@/ui/charts/format";

export const dynamic = "force-dynamic";

const AREA_TEXT: Record<string, string> = { operations: "Operations", inventory: "Inventory", quality: "Quality", sales: "Sales", finance: "Finance", owner: "Owner" };
const REFRESH_TEXT: Record<string, string> = { post: "Posted", live: "Live", mv15: "15 min", night: "Nightly", wk: "Weekly" };

/** KPI catalogue (§1.1 explainability contract) with the result of the last nightly reconciliation (§1.4). */
export default async function DefinitionsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("analytics.kpi_definition.view"))
    return (
      <>
        <PageHeader title="KPI definitions" />
        <EmptyState title={`You don't have access to KPI definitions at ${ctx.currentSite.code}`}>Ask your site manager.</EmptyState>
      </>
    );
  const sp = await searchParams;
  const d = await listKpiDefinitions(ctx, { runId: sp.run ?? null });
  return (
    <>
      <PageHeader title="KPI definitions" subtitle="What each number means, how it is calculated, which records it reads, and whether last night's recomputation matched." />
      <div className="flex flex-col gap-4">
        <div id="reconciliation">
          {d.run ? (
            <Banner tone={d.run.status !== "succeeded" ? "warn" : d.run.mismatches === 0 ? "ok" : "bad"} title={d.run.status !== "succeeded" ? `Reconciliation of ${d.run.businessDate}: ${d.run.status}` : d.run.mismatches === 0 ? `Reconciliation of ${d.run.businessDate}: every snapshot matched its source records` : `Reconciliation of ${d.run.businessDate}: ${d.run.mismatches} differences`}>
              {d.run.checked} snapshot values recomputed from posted records (stock from the ledger). Tolerance 0 for counts, quantities and ratios, ₱0.01 for money. Differences are reported, never corrected.
            </Banner>
          ) : (
            <Banner tone="info" title="No reconciliation has run yet">The nightly check runs at 02:00 after the 01:30 snapshot.</Banner>
          )}
        </div>
        {d.mismatches.length > 0 && (
          <Card>
            <h2 className="mb-3 font-display text-[17px] font-semibold">Differences found</h2>
            <Table head={["KPI", "Scope", "Grain", "From", "What differs"]}>
              {d.mismatches.map((m, i) => (
                <tr key={i}>
                  <Td className="font-mono text-[12.5px]">{m.kpiCode}</Td>
                  <Td>{m.scopeLabel}</Td>
                  <Td>{m.grain}</Td>
                  <Td>{m.periodStart}</Td>
                  <Td className="text-[12.5px]">{m.detail}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
        <div className="hidden md:block">
          <Table head={["KPI", "Definition", "Calculation", "Time basis", "Refresh", "Label", "Version", "Last check"]}>
            {d.entries.map((e) => (
              <tr key={e.code} className="align-top">
                <Td>
                  {e.visible ? (
                    <Link href={`/analytics/kpi/${e.code}`} className="font-medium text-primary-text hover:underline">
                      {e.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{e.name}</span>
                  )}
                  <div className="font-mono text-[11.5px] text-muted">
                    {e.code} · {AREA_TEXT[e.area]}
                  </div>
                </Td>
                <Td className="max-w-[260px] text-[12.5px]">{e.definition}</Td>
                <Td className="max-w-[240px] text-[12px] text-fg-2">
                  {e.formula}
                  <div className="mt-1 text-muted">Sources: {e.sources.join(", ")}</div>
                </Td>
                <Td className="max-w-[160px] text-[12px]">{e.timeBasis}</Td>
                <Td className="text-[12px]">{REFRESH_TEXT[e.refresh]}</Td>
                <Td>
                  <Chip tone={e.label === "actual" ? "neu" : "warn"}>{LABEL_TEXT[e.label]}</Chip>
                </Td>
                <Td className="text-[12px]">{e.versionNo ? `v${e.versionNo}` : "—"}</Td>
                <Td>{e.lastCheck ? <Chip tone={e.lastCheck.status === "match" ? "ok" : "bad"}>{e.lastCheck.status === "match" ? "Matched" : "Difference"}</Chip> : <span className="text-[12px] text-muted">—</span>}</Td>
              </tr>
            ))}
          </Table>
        </div>
        <ul className="flex flex-col gap-2 md:hidden">
          {d.entries.map((e) => (
            <li key={e.code} className="rounded-[12px] border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{e.name}</span>
                <Chip tone={e.label === "actual" ? "neu" : "warn"}>{LABEL_TEXT[e.label]}</Chip>
              </div>
              <p className="font-mono text-[11.5px] text-muted">{e.code}</p>
              <p className="mt-1 text-[12.5px]">{e.definition}</p>
              <p className="mt-1 text-[12px] text-muted">Time basis: {e.timeBasis}</p>
            </li>
          ))}
        </ul>
        <Card>
          <h2 className="mb-2 font-display text-[17px] font-semibold">Not available yet</h2>
          <ul className="grid gap-1.5 text-[13px]">
            {d.unavailable.map((u) => (
              <li key={u.code}>
                <span className="font-medium">{u.name}</span> <span className="font-mono text-[11.5px] text-muted">{u.code}</span> · {u.phase}: {u.reason}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
