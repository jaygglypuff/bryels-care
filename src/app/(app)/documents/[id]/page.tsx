import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getGeneratedDocument, pdfSetupMessage, REPRINT_REASONS, reprintReason, type GeneratedDocumentDetail } from "@/modules/documents";
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
        title={d.documentNumber}
        subtitle={`${d.documentKind.replace(/_/g, " ")} · ${d.template.code} v${d.template.versionNo} · Rev ${d.recordRevisionNo}`}
        actions={
          d.status === "ready" ? (
            <LinkButton href={isLabel && labelJobId ? `/print/labels/${labelJobId}` : `/print/documents/${d.id}`} target="_blank" variant="cta">
              <Printer size={16} /> Print preview
            </LinkButton>
          ) : undefined
        }
      />
      {reprinted && <Banner tone="ok" title={`Reprint ${d.reprintNo} created`}>It is marked REPRINT {d.reprintNo} and logged with your reason.</Banner>}
      {d.status === "void" && <Banner tone="bad" title="Void">{d.voidReason}</Banner>}
      {d.status === "superseded" && <Banner tone="warn" title="Superseded">A newer document replaced this one. Do not use printed copies of it.</Banner>}
      {d.status === "failed" && <Banner tone="bad" title="Rendering failed">{d.errorMessage}</Banner>}

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
        <CardTitle>Prints and reprints</CardTitle>
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
        <CardTitle>PDF file</CardTitle>
        {d.pdfAvailable ? <DownloadPdfForm id={d.id} /> : <Banner tone="info" title="PDF rendering isn't set up">{pdfSetupMessage()}</Banner>}
      </Card>

      {isLabel ? (
        labelJobId && <p className="text-[13px] text-muted">Labels are reprinted and voided from their <Link href={`/labels/jobs/${labelJobId}`} className="text-primary-text hover:underline">label job</Link>.</p>
      ) : (
        <>
          {ctx.can("documents.reprint.create") && root?.status === "ready" && (
            <Card>
              <CardTitle>Reprint</CardTitle>
              <DocReprintForm id={root.id} reasons={REPRINT_REASONS} />
            </Card>
          )}
          {ctx.can("documents.generated_document.void") && d.status === "ready" && (
            <Card>
              <CardTitle>Generated in error?</CardTitle>
              <DocVoidForm id={d.id} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
