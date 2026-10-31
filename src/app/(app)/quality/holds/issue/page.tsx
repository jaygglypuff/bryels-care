import { requireContext } from "@/lib/auth/context";
import { heldIssueFormData } from "@/modules/inventory/holds";
import { listLots } from "@/modules/inventory";
import { PageIntro } from "@/ui/guide";
import { fmtLotQty } from "../../_ui";
import { Card, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { HeldIssueForm } from "../forms";

export const metadata = { title: "Take out stopped stock" };
export const dynamic = "force-dynamic";

/** CX-LOT: issue quarantined or on-hold stock for sampling, rework or destruction (qa_qc, reason mandatory). */
export default async function HeldIssuePage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.held_stock_issue.approve")) return <Forbidden what="the held-stock exception" />;
  const locs = await heldIssueFormData(ctx);
  const lots = ctx.can("inventory.lot.view") ? (await listLots(ctx)).filter((l) => ["quarantine", "on_hold"].includes(l.qualityStatus)).map((l) => ({ lotNumber: l.lotNumber, itemName: l.itemName, onHand: fmtLotQty(l.onHand, l.baseUom) })) : [];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Take out stopped stock" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for QA: take some stock that is waiting for QA check or stopped by QA, for a test sample, to fix it, or to throw it away.</PageIntro>
      <Banner tone="warn" title="An exception, saved with your name">
        Only lots waiting for QA check or stopped by QA. Expired, not-OK and recalled stock can never be taken out. The stock record marks it as an exception.
      </Banner>
      <Card>
        <HeldIssueForm locations={locs} lots={lots} />
      </Card>
    </div>
  );
}
