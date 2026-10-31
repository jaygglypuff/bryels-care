import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtMoney } from "@/lib/qty";
import { listAdjustments } from "@/modules/inventory/adjustments";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { AdjustmentStatusChip } from "../counts/status";
import { adjustmentReasonWords } from "./reason-words";

export const metadata = { title: "Fix stock" };

const TABS = [
  ["", "All"],
  ["submitted", "Waiting for the manager"],
  ["draft", "Not finished"],
  ["approved", "Approved"],
  ["posted", "Saved to stock"],
] as const;

/** Fix stock (stock adjustments), grade-5 (ADR-088): what was fixed first, why in plain words, the number grey. */
export default async function AdjustmentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.view")) return <Forbidden what="stock fixes" />;
  const sp = await searchParams;
  const status = TABS.some(([k]) => k && k === sp.status) ? sp.status : undefined;
  const all = await listAdjustments(ctx);
  const rows = status ? all.filter((r) => r.status === status) : all;
  const waiting = all.filter((r) => r.status === "submitted").length;
  const canCreate = ctx.can("inventory.adjustment.create");
  return (
    <div className="space-y-4">
      <PageHeader title="Fix stock" subtitle={ctx.currentSite.name} actions={canCreate ? <LinkButton href="/inventory/adjustments/new" variant="cta">Fix stock</LinkButton> : undefined} />
      <PageIntro>This screen is for stock that was found, is missing, or got damaged. You send the fix, a manager says OK, and only then does stock change.</PageIntro>
      {waiting > 0 && ctx.can("inventory.adjustment.approve") && (
        <Banner tone="warn" title={`${waiting} waiting for a manager's OK`} action={<LinkButton href="/inventory/adjustments?status=submitted" variant="secondary">Look at them</LinkButton>}>
          You cannot approve a fix you made or sent yourself; another manager does.
        </Banner>
      )}
      <FilterTabs label="Filter by state" active={status ?? ""} tabs={TABS.map(([k, t]) => [k, `${t} (${k ? all.filter((r) => r.status === k).length : all.length})`, k ? `/inventory/adjustments?status=${k}` : "/inventory/adjustments"] as const)} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "Nothing here" : "No stock fixes yet"} action={canCreate && !status ? <LinkButton href="/inventory/adjustments/new" variant="cta">Fix stock</LinkButton> : status ? <LinkButton href="/inventory/adjustments" variant="secondary">Show all</LinkButton> : undefined}>
          {status ? "Choose another state above." : canCreate ? "When stock is found, missing or damaged, tap Fix stock and tell us what happened." : "Fixes made at this site show here. The warehouse sends them; a manager approves them."}
        </EmptyState>
      ) : (
        <PlainList label="Stock fixes">
          {rows.map((a) => (
            <PlainRow
              key={a.id}
              href={`/inventory/adjustments/${a.id}`}
              title={a.itemNames ?? adjustmentReasonWords(a.reasonCode)}
              status={
                <>
                  <AdjustmentStatusChip status={a.status} />
                  {a.requiresSecondApproval && a.status === "submitted" && <Chip tone="warn">Needs 2 OKs</Chip>}
                </>
              }
              facts={
                <>
                  {adjustmentReasonWords(a.reasonCode)} · {a.lines} {a.lines === 1 ? "lot" : "lots"} · {a.createdBy} · {fmtDate(a.createdAt)}
                </>
              }
              code={a.number}
              tone={a.status === "submitted" ? "warn" : undefined}
              aside={a.totalValueAmount === null ? undefined : <span className="tabular">{fmtMoney(a.totalValueAmount)}{a.valueUnknown ? "+" : ""}</span>}
            />
          ))}
        </PlainList>
      )}
    </div>
  );
}
