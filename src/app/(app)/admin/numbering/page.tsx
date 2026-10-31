import { requireContext } from "@/lib/auth/context";
import { numberingBusinessDate } from "@/lib/numbering";
import { fmtDateTime } from "@/lib/qty";
import { listNumberingAdmin } from "@/modules/governance";
import { Card, CardTitle, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { NumberingVersionForm, VersionDecision } from "./forms";
import { StepUpGate } from "../users/step-up-gate";

export const metadata = { title: "How record numbers look" };

const STATUS_TONE = { submitted: "appr", approved: "ok", rejected: "bad", cancelled: "neu" } as const;
const STATUS_TEXT: Record<string, string> = { submitted: "Waits for OK", approved: "OK'd", rejected: "Not OK'd", cancelled: "Taken back" };
const RESET_TEXT: Record<string, string> = { never: "counts up for ever", yearly: "starts again each year", monthly: "starts again each month", daily: "starts again each day" };

/** Plain names of the numbered record kinds (ADR-088). */
const NUM_TYPE: Record<string, string> = {
  GR: "Deliveries received", LOT: "Lots (sacks, drums, boxes of one delivery or batch)", BATCH: "Batches", SO: "Customer orders", DR: "Delivery papers", MOV: "Stock moves",
  QH: "Stock stopped by QA", BOX: "Boxes", TR: "Moves between places", CNT: "Stock counts", ADJ: "Stock corrections", RSV: "Stock set aside", DOC: "Printed documents",
  INS: "Quality checks", DEV: "Problem reports", WO: "Production orders", PP: "Production plans", QT: "Price offers (quotations)", PA: "Packing", PK: "Picking", SH: "Shipments",
  CMP: "Customer complaints", RT: "Customer returns", IMP: "File imports", LDOC: "Old paper documents", PR: "Requests to buy", PO: "Orders to suppliers", SRT: "Returns to suppliers",
  INV: "Customer invoices", BILL: "Supplier bills", PAY: "Payments", CN: "Credit notes", EXP: "Expense claims", CAPA: "Fix-and-prevent plans", CC: "Change requests", RC: "Product recalls",
  PM: "Regular maintenance", MWO: "Repair jobs", MAT: "Materials", PRD: "Products", SUP: "Suppliers", CUS: "Customers", LOC: "Places (shelves, rooms)",
  SKU: "Sellable items (pack sizes)", FRM: "Recipes", RTG: "Steps for each product", WI: "How-to sheets",
};
const numTypeText = (t: string) => NUM_TYPE[t] ?? t.replace(/_/g, " ");

/** Numbering rules (US-1-19 AC1–AC2): patterns per document type; changes are versions approved by a second administrator. */
export default async function NumberingPage() {
  const ctx = await requireContext();
  if (!ctx.can("platform.numbering_rule.view")) return <Forbidden what="numbering rules" />;
  const canAdmin = ctx.can("platform.numbering_rule.admin");
  const rows = await listNumberingAdmin(ctx);
  const today = numberingBusinessDate();
  return (
    <div className="space-y-5">
      <PageHeader title="How record numbers look" />
      <PageIntro>This screen is for the IT person: the system gives every record its number (nobody types one). Here you can change how the numbers look, for example the letters at the start. Numbers already given never change; a second person must OK each change.</PageIntro>
      <StepUpGate ctx={ctx} purpose="change numbering rules" />
      {!canAdmin && <Banner tone="info" title="You can look, not change">The IT person changes numbering; a second IT person or the owner says OK.</Banner>}
      <PlainList label="Kinds of records">
        {rows.map((r) => (
          <PlainRow
            key={r.documentType}
            href={`#type-${r.documentType}`}
            title={numTypeText(r.documentType)}
            status={r.versions.some((v) => v.status === "submitted") ? <Chip tone="appr">Change waits for OK</Chip> : undefined}
            facts={<>Looks like <span className="font-mono">{r.example}</span> · {RESET_TEXT[r.rule.resetPeriod] ?? r.rule.resetPeriod}</>}
          />
        ))}
      </PlainList>
      {rows.map((r) => (
        <Card key={r.documentType} id={`type-${r.documentType}`}>
          <CardTitle>{numTypeText(r.documentType)}</CardTitle>
          <p className="text-[14px] text-fg-2">
            Example: <span className="font-mono text-fg">{r.example}</span> · next: <span className="font-mono">{r.expectedNext ?? "not shown (invoices must have no gaps)"}</span> · {RESET_TEXT[r.rule.resetPeriod] ?? r.rule.resetPeriod}
          </p>
          <div className="mt-2">
            <MoreDetails title="Details and past changes">
              <p className="text-[13px] text-muted">
                Pattern <span className="font-mono">{r.rule.pattern.replace("{PREFIX}", r.rule.prefix)}</span> · {r.rule.source === "version" ? `version ${r.rule.versionNo} from ${r.rule.effectiveFrom}` : "the starting setting"} · technical name <span className="font-mono">{r.documentType}</span>
              </p>
              {r.counters.length > 0 && (
                <p className="text-[13px] text-muted">
                  Counters: {r.counters.map((c) => `${c.periodKey || "all time"} → next ${c.nextValue}`).join(" · ")}
                </p>
              )}
              {r.versions.length === 0 ? (
                <p className="text-[13px] text-muted">Never changed.</p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {r.versions.map((v) => (
                    <li key={v.id} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={STATUS_TONE[v.status as keyof typeof STATUS_TONE] ?? "neu"}>{STATUS_TEXT[v.status] ?? v.status}</Chip>
                        <span className="font-medium">Change {v.versionNo}</span>
                        <span className="font-mono">{v.pattern.replace("{PREFIX}", v.prefix)}</span>
                        <span className="text-muted">
                          from {v.effectiveFrom}
                          {v.effectiveTo ? ` until ${v.effectiveTo}` : ""}
                        </span>
                      </div>
                      <p className="text-muted">
                        {v.submitterName} · {fmtDateTime(v.submittedAt)} · “{v.changeSummary}”{v.rejectionReason ? ` · closed: ${v.rejectionReason}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </MoreDetails>
          </div>
          {r.versions
            .filter((v) => v.status === "submitted")
            .map((v) =>
              canAdmin ? (
                <div key={v.id} className="mt-3 rounded-[14px] border border-[var(--brand-200)] bg-[var(--brand-50)] p-3 text-[14px]">
                  <p className="font-medium">
                    Waiting for OK: <span className="font-mono">{v.pattern.replace("{PREFIX}", v.prefix)}</span> from {v.effectiveFrom} (asked by {v.submitterName})
                  </p>
                  <VersionDecision id={v.id} isOwn={v.submittedBy === ctx.userId} />
                </div>
              ) : null,
            )}
          {canAdmin && (
            <details className="mt-2">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Change how these numbers look</summary>
              <NumberingVersionForm documentType={r.documentType} current={r.rule} today={today} />
            </details>
          )}
        </Card>
      ))}
    </div>
  );
}
