import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { expiryAlerts } from "@/modules/inventory/lots-admin";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { Expiry, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";

export const metadata = { title: "Expiry alerts" };

/**
 * US-2-16 expiry alert list (A-KPI-03 buckets from settings). The nightly notification job
 * (expiring_lot notifications to site_manager and qa_qc) needs the jobs platform (US-2-03).
 */
export default async function ExpiryPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="expiry alerts" />;
  const { buckets, rows } = await expiryAlerts(ctx);
  const groups = ["expired", ...buckets.map((b) => `≤ ${b} days`)];
  return (
    <div className="space-y-5">
      <PageHeader title="Expiry alerts" subtitle={`${ctx.currentSite.code} · lots with stock that expired or expire within ${buckets.at(-1)} days, earliest first (FEFO)`} />
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <Chip key={g} tone={g === "expired" ? "bad" : "warn"}>{g}: {rows.filter((r) => r.bucket === g).length}</Chip>
        ))}
      </div>
      {groups.map((g) => {
        const list = rows.filter((r) => r.bucket === g);
        return (
          <Card key={g}>
            <CardTitle>{g === "expired" ? "Expired, still in stock" : `Expiring ${g}`}</CardTitle>
            {list.length === 0 ? (
              <EmptyState title="Nothing here" />
            ) : (
              <Table head={["Lot", "Item", "Expiry", "On hand", "Locations", "Status"]}>
                {list.map((r) => (
                  <tr key={r.id}>
                    <Td><Link href={`/inventory/${r.id}`} className="font-mono font-semibold text-primary-text hover:underline">{r.lotNumber}</Link></Td>
                    <Td>{r.itemName}<div className="text-[12px] text-muted">{r.itemCode}</div></Td>
                    <Td><Expiry date={r.expiresOn} /></Td>
                    <Td className="font-medium">{fmtLotQty(r.onHand, r.baseUom)}</Td>
                    <Td className="text-[12px]">{r.locationCodes}</Td>
                    <Td><StatusChip status={r.qualityStatus} /></Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
