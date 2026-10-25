import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { TAX_KIND_LABEL, listTaxConfigurations } from "@/modules/finance";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, ResponsiveList } from "../finance-ui";
import { ProposeTaxForm, TaxRowCommand } from "./forms";

export const metadata = { title: "Tax configuration" };

/**
 * US-6-14: tax codes and rates as reviewed data. No rate exists in code; a version is effective only after
 * a second person (normally the accountant) approves it. Posted documents keep the rate they used.
 */
export default async function TaxPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.tax_config.view")) return <Forbidden what="tax configuration" />;
  const { rows, defaults, today } = await listTaxConfigurations(ctx);
  const admin = ctx.can("finance.tax_config.admin");
  return (
    <>
      <PageHeader title="Tax configuration" subtitle="The system computes tax from these reviewed rows; it does not decide which tax applies, file returns or decide whether its invoice is the official tax document." />
      <div className="mb-4">
        <Banner tone="info" title={`Sales tax code in use: ${defaults.sales ?? "none (no tax line)"} · purchases: ${defaults.purchases ?? "none"}`}>
          The codes used by default are settings (Finance group){ctx.can("platform.settings.view") ? <> — change them in <Link className="underline" href="/admin/settings">Admin → Settings</Link> (second approver)</> : null}. Rows marked FICTIONAL are demo placeholders, not real rates.
        </Banner>
      </div>
      <div className={admin ? "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]" : ""}>
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState title="No tax rates configured">Until the accountant&apos;s rates are entered and reviewed, documents carry no tax line.</EmptyState>
          ) : (
            <ResponsiveList
              rows={rows}
              rowKey={(r) => r.id}
              head={["Code", "Name", "Applies to", "Rate", "From", "Status", "Reviewer", ""]}
              cells={(r) => [
                <span key="c" className="font-medium">
                  {r.code} v{r.versionNo}
                  {r.isFictional && <span className="ml-1 text-[11px] font-semibold text-[var(--warn-fg)]">FICTIONAL</span>}
                </span>,
                <span key="n">
                  {r.name}
                  <span className="block text-[12px] text-muted">{TAX_KIND_LABEL[r.kind as keyof typeof TAX_KIND_LABEL] ?? r.kind}</span>
                </span>,
                r.appliesTo,
                `${Number(r.ratePct)} %${r.inclusive ? " incl." : ""}`,
                `${fmtDate(r.effectiveFrom)}${r.effectiveTo ? ` – ${fmtDate(r.effectiveTo)}` : ""}`,
                <span key="s" className="inline-flex flex-wrap gap-1">
                  <FinanceStatus status={r.status} />
                  {r.effectiveNow && <FinanceStatus status="paid" label="In effect" />}
                  {r.scheduled && <FinanceStatus status="issued" label="Scheduled" />}
                </span>,
                r.reviewedByName ?? "—",
                admin ? (
                  <span key="a" className="flex flex-col gap-2">
                    {r.status === "proposed" && r.proposedBy !== ctx.userId && <TaxRowCommand id={r.id} command="approve" label="Approve" variant="cta" />}
                    {r.status === "proposed" && <TaxRowCommand id={r.id} command="reject" label="Reject" variant="danger" />}
                    {r.status === "approved" && <TaxRowCommand id={r.id} command="retire" label="Retire" />}
                  </span>
                ) : null,
              ]}
              mobile={(r) => (
                <Card className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {r.code} v{r.versionNo}
                    </span>
                    <FinanceStatus status={r.status} />
                  </div>
                  <p className="text-[13px]">
                    {r.name} · {Number(r.ratePct)} % · {r.appliesTo}
                    {r.isFictional ? " · FICTIONAL" : ""}
                  </p>
                  <p className="text-[12px] text-muted">from {fmtDate(r.effectiveFrom)}</p>
                  {admin && r.status === "proposed" && r.proposedBy !== ctx.userId && <TaxRowCommand id={r.id} command="approve" label="Approve" variant="cta" />}
                </Card>
              )}
            />
          )}
        </div>
        {admin && <ProposeTaxForm kinds={Object.entries(TAX_KIND_LABEL).map(([value, label]) => ({ value, label }))} today={today} />}
      </div>
    </>
  );
}
