import { requireContext } from "@/lib/auth/context";
import { PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ScanClient } from "./scan-client";

export const metadata = { title: "Scan / look up" };

export default async function ScanPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="scanning and look-up" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Scan / look up" subtitle={`${ctx.currentSite.code} · camera, handheld scanner or typed code`} />
      <ScanClient />
    </div>
  );
}
