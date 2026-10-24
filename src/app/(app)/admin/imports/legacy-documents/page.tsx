import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { issueImportFileUrl, searchLegacyDocuments } from "@/modules/imports";
import { Card, CardTitle, EmptyState, Input, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { VerifyForm } from "../forms";

export const metadata = { title: "Legacy documents" };

/** Search of the scanned paper records by the number staff know (US-2-26, R-17). */
export default async function LegacyDocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("documents.legacy_document.view")) return <Forbidden what="legacy documents" />;
  const { q } = await searchParams;
  const docs = await searchLegacyDocuments(ctx, { q });
  const links = new Map<string, string>();
  if (ctx.can("documents.file_attachment.view")) for (const d of docs) links.set(d.id, (await issueImportFileUrl(ctx, d.fileAttachmentId)).url);
  return (
    <div className="space-y-5">
      <PageHeader title="Legacy documents" subtitle="Scanned paper batch records and other historical documents, indexed at go-live. They are history only: never batches, never stock." />
      <Card>
        <form className="mb-3 flex gap-2" action="/admin/imports/legacy-documents">
          <Input name="q" defaultValue={q ?? ""} placeholder="Legacy number, LDOC number or product" aria-label="Search" />
        </form>
        {docs.length === 0 ? (
          <EmptyState title="No legacy documents">{q ? "Nothing matches the search." : "Scanned records appear here after a legacy documents import is posted."}</EmptyState>
        ) : (
          <Table head={["Document", "Legacy number", "Product", "Dates", "Disposition", "Index check", "Scan"]}>
            {docs.map((d) => (
              <tr key={d.id} className="align-top">
                <Td className="font-mono">{d.documentNumber}</Td>
                <Td>
                  {d.legacyKind.toUpperCase()} {d.legacyNumber}
                </Td>
                <Td>{d.productCode ? `${d.productCode} ${d.productName}` : "—"}</Td>
                <Td className="text-[13px]">
                  {d.startDate ? fmtDate(d.startDate) : "?"} – {d.endDate ? fmtDate(d.endDate) : "?"}
                  {d.expiryDate ? ` · exp ${fmtDate(d.expiryDate)}` : ""}
                </Td>
                <Td>{d.disposition ?? "—"}</Td>
                <Td className="text-[13px]">
                  {d.verifiedAt ? (
                    <Chip tone="ok">Verified by {d.verifiedByName}</Chip>
                  ) : ctx.can("documents.legacy_document.approve") && d.indexedBy !== ctx.userId ? (
                    <VerifyForm documentId={d.id} />
                  ) : (
                    <Chip tone="warn">Not verified (indexed by {d.indexedByName})</Chip>
                  )}
                </Td>
                <Td>{links.get(d.id) ? <a className="text-primary-text underline" href={links.get(d.id)}>Download</a> : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card>
        <CardTitle>How documents are added</CardTitle>
        <p className="text-[13px] text-muted">Use the “Legacy documents (scanned BMRs)” import: fill the template with the header fields as printed, upload the scans with matching file names, validate, approve and post. A second person verifies each index against its scan.</p>
      </Card>
    </div>
  );
}
