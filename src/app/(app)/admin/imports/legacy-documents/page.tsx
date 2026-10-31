import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { issueImportFileUrl, searchLegacyDocuments } from "@/modules/imports";
import { Card, EmptyState, Input, PageHeader, buttonClass } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { VerifyForm } from "../forms";

export const metadata = { title: "Old paper documents" };

/** Search of the scanned paper records by the number staff know (US-2-26, R-17). One card per document (phone-friendly). */
export default async function LegacyDocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("documents.legacy_document.view")) return <Forbidden what="old paper documents" />;
  const { q } = await searchParams;
  const docs = await searchLegacyDocuments(ctx, { q });
  const links = new Map<string, string>();
  if (ctx.can("documents.file_attachment.view")) for (const d of docs) links.set(d.id, (await issueImportFileUrl(ctx, d.fileAttachmentId)).url);
  return (
    <div className="space-y-5">
      <PageHeader title="Old paper documents" />
      <PageIntro>This screen is for finding a scanned paper record from before the app (for example an old batch record). Type the number written on the paper or the product name. These are history only: they are never batches or stock.</PageIntro>
      <Card>
        <form className="mb-3 flex gap-2" action="/admin/imports/legacy-documents" role="search">
          <Input name="q" defaultValue={q ?? ""} placeholder="Number on the paper, or product" aria-label="Search old documents" />
          <button className={buttonClass("secondary")}>Search</button>
        </form>
        {docs.length === 0 ? (
          <EmptyState title="Nothing found">{q ? "Check the number, or try the product name." : "Scanned records appear here after they are loaded (see below)."}</EmptyState>
        ) : (
          <ul aria-label="Old documents" className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-fg">
                    {d.productName ?? "No product"} · {d.legacyKind.toUpperCase()} {d.legacyNumber}
                  </p>
                  <p className="text-[13px] text-fg-2">
                    {d.startDate ? fmtDate(d.startDate) : "?"} – {d.endDate ? fmtDate(d.endDate) : "?"}
                    {d.expiryDate ? ` · expires ${fmtDate(d.expiryDate)}` : ""}
                    {d.disposition ? ` · QA: ${d.disposition}` : ""}
                    <span className="ml-1 font-mono text-[12px] text-muted">· {d.documentNumber}</span>
                  </p>
                  <div className="mt-1 text-[13px]">
                    {d.verifiedAt ? (
                      <Chip tone="ok">Checked by {d.verifiedByName}</Chip>
                    ) : ctx.can("documents.legacy_document.approve") && d.indexedBy !== ctx.userId ? (
                      <VerifyForm documentId={d.id} />
                    ) : (
                      <Chip tone="warn">Not checked yet (typed in by {d.indexedByName})</Chip>
                    )}
                  </div>
                </div>
                {links.get(d.id) && (
                  <a className={buttonClass("secondary", "sm")} href={links.get(d.id)}>
                    Open the scan
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <MoreDetails title="How old documents are added">
        <p className="text-[13px] text-muted">Use “Load data from a spreadsheet” → “Legacy documents (scanned BMRs)”: fill the template with what is printed on each paper, upload the scans with the same file names, check, get an OK and save. A second person checks each entry against its scan.</p>
      </MoreDetails>
    </div>
  );
}
