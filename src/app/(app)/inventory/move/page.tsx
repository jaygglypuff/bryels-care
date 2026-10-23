import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listRecentTransfers, listSiteLocations } from "@/modules/inventory/moves";
import { getContainer } from "@/modules/inventory/containers";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { lookupSourceAction, lotSourceById, type SourceInfo } from "./actions";
import { MoveFlow } from "./move-flow";

export const metadata = { title: "Scan to move" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function MovePage({ searchParams }: { searchParams: Promise<{ box?: string; lot?: string; to?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.post")) return <Forbidden what="moving stock" />;
  const sp = await searchParams;
  const locations = ctx.can("masterdata.location.view") ? await listSiteLocations(ctx) : [];
  let initialSource: SourceInfo | null = null;
  if (sp.box && UUID.test(sp.box) && ctx.can("inventory.container.view")) {
    try {
      const box = await getContainer(ctx, sp.box);
      const r = await lookupSourceAction(`BC:BOX:${box.containerNumber}`);
      if (r.ok) initialSource = r.data;
    } catch {
      initialSource = null;
    }
  } else if (sp.lot && UUID.test(sp.lot)) {
    initialSource = await lotSourceById(sp.lot);
  }
  const initialDestination = sp.to ? (locations.find((l) => l.id === sp.to) ?? null) : null;
  const recent = ctx.can("inventory.movement.view") ? await listRecentTransfers(ctx, 15) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Scan to move" subtitle={`${ctx.currentSite.code} · scan the box or lot, the quantity, then the destination; confirm once`} />
      {locations.length === 0 ? (
        <EmptyState title="No locations at this site">Locations are set up by the system administrator.</EmptyState>
      ) : (
        <MoveFlow locations={locations} initialSource={initialSource} initialDestination={initialDestination} />
      )}
      {ctx.can("inventory.movement.view") && (
        <Card>
          <CardTitle action={<Link href="/inventory/movements" className="text-[13px] text-primary-text hover:underline">Full ledger</Link>}>Recent moves</CardTitle>
          {recent.length === 0 ? (
            <EmptyState title="No moves yet">Scan-moves and inter-site transfers at this site appear here.</EmptyState>
          ) : (
            <Table head={["Number", "What", "From → to", "By", "When", ""]}>
              {recent.map((t) => (
                <tr key={t.id}>
                  <Td className="font-mono">{t.number}</Td>
                  <Td>{t.boxNumber ? `Box ${t.boxNumber}` : t.kind === "inter_site" ? "Inter-site" : "Lot stock"}</Td>
                  <Td className="font-mono text-[12px]">
                    {t.fromCode} → {t.toCode}
                  </Td>
                  <Td>{t.byName}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(t.completedAt)}</Td>
                  <Td>{t.undoneAt ? <Chip tone="warn">Undone</Chip> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
