import { requireContext } from "@/lib/auth/context";
import { holdFormData } from "@/modules/inventory/holds";
import { Card, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { PlaceHoldForm } from "../forms";

export const metadata = { title: "Place QA hold" };

export default async function NewHoldPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.hold.create")) return <Forbidden what="placing holds" />;
  const { lot } = await searchParams;
  const data = await holdFormData(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Place QA hold" subtitle={`${ctx.currentSite.code} · blocks allocation, issue and shipment until a QA user other than you lifts it`} />
      <Card>
        <PlaceHoldForm locations={data.locations} reasonCodes={data.reasonCodes} defaultLot={lot} />
      </Card>
    </div>
  );
}
