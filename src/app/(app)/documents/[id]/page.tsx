import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getGeneratedDocument, pdfSetupMessage, reprintReasonOptions, type GeneratedDocumentDetail } from "@/modules/documents";
import { PageIntro } from "@/ui/guide";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DocReprintForm, DocVoidForm, DownloadPdfForm } from "../forms";

export const metadata = { title: "Document" };
export const dynamic = "force-dynamic";

const SOURCE_HREF: Record<string, (id: string) => string> = {
  inventory_lot: (id) => `/inventory/${id}`,
  batch: (id) => `/production/${id}`, // Wave 2 W2D: BMR and paper pages
};

/** Generated document record: identity, template version, hash, reprint history (ux-system §9.12). */
export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reprinted?: string }> }) {
  const ctx = await requireContext();
  const reprintReasons = await reprintReasonOptions(ctx);
  const reprintReason = (code: string) => reprintReasons.find((r) => r.code === code) ?? null;
  if (!ctx.can("documents.generated_document.view")) return <Forbidden what="documents" />;
  const { id } = await params;
  const { reprinted } = await searchParams;
  let d: GeneratedDocumentDetail;
  try {
    d = await getGeneratedDocument(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const isLabel = d.documentKind === "label";
  const labelJobId = (d.parameters as { labelJobId?: string } | null)?.labelJobId;
  const sourceHref = d.sourceEntityType === "document_template_version" ? `/admin/templates/${d.template.templateId}` : SOURCE_HREF[d.sourceEntityType]?.(d.sourceEntityId);
  const root = d.chain.find((c) => c.reprintNo === 0);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={`${d.documentKind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} ${d.documentNumber}`}
        subtitle={`Layout version ${d.template.versionNo} · record change ${d.recordRevisionNo}`}
        actions={
          d.status === "ready" ? (
            <LinkButton href={isLabel && labelJobId ? `/print/labels/${labelJobId}` : `/print/documents/${d.id}`} target="_blank" variant="cta">
              <Printer size={16} /> Print preview
            </LinkButton>
          ) : undefined
        }
      />
      <PageIntro>This screen is for one printed page made by the system (for example a batch record or delivery paper): which record it belongs to, every printed copy, the PDF, and printing it again with a reason.</PageIntro>
      {reprinted && <Banner tone="ok" title={`Reprint ${d.reprintNo} created`}>It is marked REPRINT {d.reprintNo} and logged with your reason.</Banner>}
      {d.status === "void" && <Banner tone="bad" title="Cancelled – do not use">{d.voidReason}</Banner>}
      {d.status === "superseded" && <Banner tone="warn" title="Replaced by a newer one">Do not use printed copies of this one.</Banner>}
      {d.status === "failed" && <Banner tone="bad" title="It could not be made">{d.errorMessage} Tell the IT person.</Banner>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <CardTitle>Record</CardTitle>
          <Chip tone={d.status === "ready" ? "ok" : d.status === "void" ? "bad" : "warn"}>{d.status}</Chip>
          {d.watermark && <Chip tone="neu">{d.watermark}</Chip>}
        </div>
        <Dl
          items={[
            ["Generated", `${d.template.generatedByName}, ${fmtDateTime(d.generatedAt)}`],
            ["Template", `${d.template.code} v${d.template.versionNo}`],
            ["Source", sourceHref ? <Link key="s" href={sourceHref} className="text-primary-text hover:underline">{d.sourceEntityType.replace(/_/g, " ")}</Link> : d.sourceEntityType.replace(/_/g, " ")],
            ["Source revision", fmtDateTime(d.sourceRevisionAt)],
            ["Status at render", d.sourceState ?? "—"],
            ["Pages", d.pageCount ? String(d.pageCount) : "—"],
            ["SHA-256", <span key="h" className="break-all font-mono text-[12px]">{d.checksumSha256 ?? "—"}</span>],
            ["Output", d.outputFormat === "html" ? "Browser print (no stored PDF)" : "Stored PDF"],
          ]}
        />
      </Card>

      <Card>
        <CardTitle>Printed copies</CardTitle>
        <ol className="divide-y divide-line text-[13px]">
          {d.chain.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/documents/${c.id}`} className="text-primary-text hover:underline">{c.documentNumber} · {c.reprintNo ? `Reprint ${c.reprintNo}` : "Original"}</Link>
              <span className="text-muted">{c.generatedByName}, {fmtDateTime(c.generatedAt)}{c.reprintReasonCode ? ` · ${reprintReason(c.reprintReasonCode)?.label ?? c.reprintReasonCode}${c.reprintNote ? `: ${c.reprintNote}` : ""}` : ""}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardTitle>PDF file (to save or send)</CardTitle>
        {d.pdfAvailable ? <DownloadPdfForm id={d.id} /> : <Banner tone="info" title="PDF rendering isn't set up">{pdfSetupMessage()}</Banner>}
      </Card>

      {isLabel ? (
        labelJobId && <p className="text-[13px] text-muted">Labels are reprinted and voided from their <Link href={`/labels/jobs/${labelJobId}`} className="text-primary-text hover:underline">label job</Link>.</p>
      ) : (
        <>
          {ctx.can("documents.reprint.create") && root?.status === "ready" && (
            <Card>
              <CardTitle>Print it again</CardTitle>
              <DocReprintForm id={root.id} reasons={reprintReasons} />
            </Card>
          )}
          {ctx.can("documents.generated_document.void") && d.status === "ready" && (
            <Card>
              <CardTitle>Made by mistake?</CardTitle>
              <DocVoidForm id={d.id} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
