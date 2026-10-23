import { requireContext } from "@/lib/auth/context";
import { heldIssueFormData } from "@/modules/inventory/holds";
import { Card, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { HeldIssueForm } from "../forms";

export const metadata = { title: "Held-stock issue" };

/** CX-LOT: issue quarantined or on-hold stock for sampling, rework or destruction (qa_qc, reason mandatory). */
export default async function HeldIssuePage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.held_stock_issue.approve")) return <Forbidden what="the held-stock exception" />;
  const locs = await heldIssueFormData(ctx);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Held-stock issue" subtitle={`${ctx.currentSite.code} · controlled exception for quarantined or on-hold lots`} />
      <Banner tone="warn" title="Exception, recorded against your name">
        Only quarantined or on-hold lots qualify. Expired, rejected and recalled stock can never be issued. The movement is marked as an exception in the ledger and audit log.
      </Banner>
      <Card>
        <HeldIssueForm locations={locs} />
      </Card>
    </div>
  );
}
