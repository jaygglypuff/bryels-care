import { requireContext } from "@/lib/auth/context";
import { PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ScanClient } from "./scan-client";

export const metadata = { title: "Scan or search" };

export default async function ScanPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="scanning and look-up" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Scan or search" subtitle="Scan a label, or type a name like 'coconut oil', a lot, batch or order number." />
      <ScanClient />
    </div>
  );
}
