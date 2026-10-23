import { requireContext } from "@/lib/auth/context";
import { PageHeader } from "@/ui/core";

export default async function Dashboard() {
  const ctx = await requireContext();
  return <PageHeader title="Overview" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}`} />;
}
