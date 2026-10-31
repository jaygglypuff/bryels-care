import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { TAX_KIND_LABEL, listTaxConfigurations } from "@/modules/finance";
import { EmptyState, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { FinanceStatus } from "../finance-ui";
import { ProposeTaxForm, TaxRowCommand } from "./forms";

export const metadata = { title: "Tax rates" };

const USED_ON: Record<string, string> = { sales: "sales", purchases: "buying", expenses: "expense claims" };

/**
 * US-6-14 as "Tax rates": rates as checked data. No rate exists in code; a version is used only after a second
 * person (normally the accountant) approves it. Saved papers keep the rate they used.
 */
export default async function TaxPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.tax_config.view")) return <Forbidden what="tax rates" />;
  const { rows, defaults, today } = await listTaxConfigurations(ctx);
  const admin = ctx.can("finance.tax_config.admin");
  const toCheck = admin ? rows.filter((r) => r.status === "proposed" && r.proposedBy !== ctx.userId) : [];
  const codes = [...new Map(rows.filter((r) => r.status !== "retired").map((r) => [r.code, { code: r.code, name: r.name }])).values()];
  return (
    <>
      <PageHeader title="Tax rates" />
      <PageIntro>This screen is for the tax rates the accountant gave us. The system only adds tax with rates checked by a second person; it does not decide which tax applies or file tax returns.</PageIntro>
      {toCheck.length > 0 && <NextStep text={`Next: ${toCheck.length} rate(s) wait for your check.`} action={{ label: "Check them", href: `#t-${toCheck[0].id}` }} />}
      <div className="mb-4">
        <Banner tone="info" title={`Used on sales: ${defaults.sales ?? "no tax"} · on buying: ${defaults.purchases ?? "no tax"}`}>
          Which rate is used by default is a setting{ctx.can("platform.settings.view") ? <> (<Link className="underline" href="/admin/settings">Management → System → Settings</Link>, needs a second approver)</> : null}. Rates marked “Made up” are demo examples, not real rates.
        </Banner>
      </div>
      <div className={admin ? "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]" : ""}>
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState title="No tax rates yet">Until the accountant&apos;s rates are typed in and checked, invoices and bills have no tax line.{admin ? " Add one with the form." : " Ask finance."}</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="Tax rates">
              {rows.map((r) => (
                <li key={r.id} id={`t-${r.id}`} className="scroll-mt-24 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{r.name}</span>
                    <FinanceStatus status={r.status} />
                    {r.effectiveNow && <FinanceStatus status="paid" label="In use now" />}
                    {r.scheduled && <FinanceStatus status="issued" label="Starts later" />}
                    {r.isFictional && <Chip tone="warn">Made up (demo)</Chip>}
                  </div>
                  <p className="mt-0.5 text-[14px] text-fg-2">
                    <strong className="tabular-nums text-fg">{Number(r.ratePct)} %</strong>
                    {r.inclusive ? " (already in the price)" : ""} on {USED_ON[r.appliesTo] ?? r.appliesTo} · from {fmtDate(r.effectiveFrom)}
                    {r.effectiveTo ? ` to ${fmtDate(r.effectiveTo)}` : ""} · {TAX_KIND_LABEL[r.kind as keyof typeof TAX_KIND_LABEL] ?? r.kind}
                    {r.reviewedByName ? ` · checked by ${r.reviewedByName}` : ""}
                    <span className="ml-1 font-mono text-[12px] text-muted">
                      · {r.code} v{r.versionNo}
                    </span>
                  </p>
                  {admin && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.status === "proposed" && r.proposedBy !== ctx.userId && <TaxRowCommand id={r.id} command="approve" label="It is right: use it" variant="cta" />}
                      {r.status === "proposed" && r.proposedBy === ctx.userId && <p className="text-[13px] text-muted">You typed it in, so someone else checks it.</p>}
                      {r.status === "proposed" && <TaxRowCommand id={r.id} command="reject" label="It is wrong" variant="danger" />}
                      {r.status === "approved" && <TaxRowCommand id={r.id} command="retire" label="Stop using it" />}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {admin && <ProposeTaxForm kinds={Object.entries(TAX_KIND_LABEL).map(([value, label]) => ({ value, label }))} today={today} codes={codes} />}
      </div>
    </>
  );
}
