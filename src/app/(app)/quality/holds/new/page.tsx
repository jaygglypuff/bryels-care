import { requireContext } from "@/lib/auth/context";
import { holdFormData } from "@/modules/inventory/holds";
import { listLots } from "@/modules/inventory";
import { PageIntro } from "@/ui/guide";
import { fmtLotQty } from "../../_ui";
import { Card, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { PlaceHoldForm } from "../forms";

export const metadata = { title: "Stop a lot" };
export const dynamic = "force-dynamic";

export default async function NewHoldPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.hold.create")) return <Forbidden what="placing holds" />;
  const { lot } = await searchParams;
  const data = await holdFormData(ctx);
  const lots = ctx.can("inventory.lot.view") ? (await listLots(ctx)).filter((l) => ["released", "quarantine"].includes(l.qualityStatus)).map((l) => ({ lotNumber: l.lotNumber, itemName: l.itemName, onHand: fmtLotQty(l.onHand, l.baseUom) })) : [];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Stop a lot" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for QA: stop a lot (or a whole place) so nobody uses, sets aside or ships it. A second QA person lets it go again.</PageIntro>
      <Card>
        <PlaceHoldForm locations={data.locations} reasonCodes={data.reasonCodes} defaultLot={lot} lots={lots} />
      </Card>
    </div>
  );
}
