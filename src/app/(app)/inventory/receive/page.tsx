import { randomUUID } from "node:crypto";
import { requireContext } from "@/lib/auth/context";
import { receivingFormData } from "@/modules/inventory/receiving";
import { EmptyState, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ReceiveForm } from "./receive-form";

export const metadata = { title: "Receive materials" };

export default async function ReceivePage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.receipt.post")) return <Forbidden what="receiving materials" />;
  const { materials, locations } = await receivingFormData(ctx);
  const defaultLocation = locations.find((l) => l.kind === "quarantine") ?? locations[0];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Receive materials" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · unplanned receipt from a supplier delivery`} />
      {materials.length === 0 || !defaultLocation ? (
        <EmptyState title="Receiving is not set up for this site">
          {materials.length === 0 ? "No materials exist yet. Create materials in Master data first." : "This site has no receiving, quarantine or storage location."}
        </EmptyState>
      ) : (
        <ReceiveForm idempotencyKey={randomUUID()} materials={materials} locations={locations} defaultLocationId={defaultLocation.id} />
      )}
    </div>
  );
}
