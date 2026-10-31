import { requireContext } from "@/lib/auth/context";
import { recallScope, type RecallQuery } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
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
  if (!ctx.can("quality.recall_case.create") || !ctx.can("quality.genealogy.view")) return <Forbidden what="starting product recalls" />;
  const sp = await searchParams;
  const mode = sp.mode === "reverse" ? "reverse" : "forward";
  const complaintId = sp.complaintId && /^[0-9a-f-]{36}$/i.test(sp.complaintId) ? sp.complaintId : undefined;
  const q: RecallQuery = complaintId ? { complaintId } : sp.supplierLot?.trim() ? { supplierLot: sp.supplierLot.trim() } : { code: sp.code?.trim() || undefined };
  const searched = !!(q.complaintId || q.supplierLot || q.code);
  const r = searched ? await recallScope(ctx, { ...q, mode }) : null;
  const lots = r ? r.lots.filter((l) => l.role !== "upstream") : [];
  return (
    <>
      <PageHeader title="Start a product recall" actions={<LinkButton href={`/quality/recall${searched ? `?${new URLSearchParams({ ...(q.code ? { code: q.code } : {}), ...(q.supplierLot ? { supplierLot: q.supplierLot } : {}), ...(q.complaintId ? { complaintId: q.complaintId } : {}), mode }).toString()}` : ""}`} variant="secondary">Back to the list of customers</LinkButton>} />
      <PageIntro>This screen is for QA: start a product recall from the list of who received it. Nothing is stopped yet: it is a draft until two people approve.</PageIntro>
      {searched && r?.subject && <NextStep text="Next: choose the kind, give it a short name and say why, then save the draft." />}
      {!searched ? (
        <EmptyState title="Start from the product" action={<LinkButton href="/quality/recall">Who received it</LinkButton>}>
          First choose the product on “Who received it”, then press “Start a product recall”.
        </EmptyState>
      ) : !r?.subject ? (
        <EmptyState title="Nothing found">{r?.notFoundMessage} Check the number, or ask QA.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardTitle>What it covers ({mode === "forward" ? "where it went" : "also batches that used the same materials"})</CardTitle>
            <Dl
              items={[
                ["Started from", `${r.subject.label} (${r.subject.number})`],
                ["Lots to call back", String(lots.length)],
                ["Boxes", String(r.boxes.length)],
                ["Deliveries", String(r.shipments.length)],
                ["Customers", String(r.customers.length)],
                ["Sites", r.siteCodes.join(", ")],
              ]}
            />
            {r.hiddenCount > 0 && (
              <div className="mt-3">
                <Banner tone="warn" title={`${r.hiddenCount} linked record(s) are at sites you cannot see`}>They are not in this recall. Ask a QA person with access to those sites (or the owner) to look too.</Banner>
              </div>
            )}
          </Card>
          <Card>
            <CardTitle>The recall</CardTitle>
            <OpenRecallForm query={{ ...q, mode }} />
          </Card>
        </div>
      )}
    </>
  );
}
