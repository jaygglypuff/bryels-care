import { requireContext } from "@/lib/auth/context";
import { PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { ScanClient } from "./scan-client";

export const metadata = { title: "Scan or search" };

export default async function ScanPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="scanning and look-up" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Scan or search" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for finding anything fast: scan a label with the camera or scanner, or type a name like “coconut oil”. You see what it is, if it is OK to use, and what you can do next.</PageIntro>
      <ScanClient />
    </div>
  );
}
