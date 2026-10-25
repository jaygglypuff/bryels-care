import { requireContext } from "@/lib/auth/context";
import { recallScope, type RecallQuery } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { OpenRecallForm } from "../forms";

export const dynamic = "force-dynamic";

/**
 * Start a recall case from the explorer's scope (ux-system §9.14 "Start recall case"): the same query as
 * /quality/recall; the scope shown here is re-traced and stored when the case opens.
 */
export default async function NewRecallPage({ searchParams }: { searchParams: Promise<{ code?: string; supplierLot?: string; complaintId?: string; mode?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.recall_case.create") || !ctx.can("quality.genealogy.view")) return <Forbidden what="opening recall cases" />;
  const sp = await searchParams;
  const mode = sp.mode === "reverse" ? "reverse" : "forward";
  const complaintId = sp.complaintId && /^[0-9a-f-]{36}$/i.test(sp.complaintId) ? sp.complaintId : undefined;
  const q: RecallQuery = complaintId ? { complaintId } : sp.supplierLot?.trim() ? { supplierLot: sp.supplierLot.trim() } : { code: sp.code?.trim() || undefined };
  const searched = !!(q.complaintId || q.supplierLot || q.code);
  const r = searched ? await recallScope(ctx, { ...q, mode }) : null;
  const lots = r ? r.lots.filter((l) => l.role !== "upstream") : [];
  return (
    <>
      <PageHeader title="Open a recall case" subtitle="From the recall explorer's scope: affected lots, boxes, shipments and customers" actions={<LinkButton href={`/quality/recall${searched ? `?${new URLSearchParams({ ...(q.code ? { code: q.code } : {}), ...(q.supplierLot ? { supplierLot: q.supplierLot } : {}), ...(q.complaintId ? { complaintId: q.complaintId } : {}), mode }).toString()}` : ""}`} variant="secondary">Back to the explorer</LinkButton>} />
      {!searched ? (
        <EmptyState title="Start from the recall explorer" action={<LinkButton href="/quality/recall">Recall explorer</LinkButton>}>
          Trace the lot, box, batch, supplier lot or complaint first, then choose “Open recall case”.
        </EmptyState>
      ) : !r?.subject ? (
        <EmptyState title="Nothing found">{r?.notFoundMessage}</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardTitle>Scope ({mode === "forward" ? "forward: where it went" : "reverse: inputs and sibling batches too"})</CardTitle>
            <Dl
              items={[
                ["Starting point", `${r.subject.kind.replace("_", " ")} ${r.subject.number}`],
                ["Lots to recall", String(lots.length)],
                ["Boxes", String(r.boxes.length)],
                ["Shipments", String(r.shipments.length)],
                ["Customers", String(r.customers.length)],
                ["Sites", r.siteCodes.join(", ")],
              ]}
            />
            {r.hiddenCount > 0 && (
              <div className="mt-3">
                <Banner tone="warn" title={`${r.hiddenCount} linked record(s) are at sites outside your access`}>They are not in the case. Ask a QA user with access to those sites (or the owner) to review the scope.</Banner>
              </div>
            )}
          </Card>
          <Card>
            <CardTitle>Case</CardTitle>
            <OpenRecallForm query={{ ...q, mode }} />
          </Card>
        </div>
      )}
    </>
  );
}
