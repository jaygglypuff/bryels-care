import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtQty } from "@/lib/qty";
import { listProducts } from "@/modules/production";
import { Card, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.product.view")) return <Forbidden what="products" />;
  const rows = await listProducts(ctx);
  const sites = ctx.allowedSites.map((s) => s.code).join(", ");
  return (
    <div>
      <PageHeader title="Products" subtitle={`Finished goods. Stock on hand across your sites (${sites}).`} />
      {rows.length === 0 ? (
        <EmptyState title="No products yet">Products are the finished goods (SKUs) made from approved formulas.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((p) => (
              <Card key={p.id}>
                <p className="font-mono text-[13px] font-semibold">{p.skuCode}</p>
                <p className="font-medium">{p.name}</p>
                <p className="mt-1 text-[12px] text-muted tabular">
                  {p.family} · {fmtQty(p.unitNetMassG, "g", 0)} net · {p.unitsPerBox}/box · shelf life {p.shelfLifeDays} days
                </p>
                <p className="mt-1 text-[13px] tabular">
                  On hand {fmtQty(p.onHand, "pcs", 0)} · released {fmtQty(p.released, "pcs", 0)}
                </p>
              </Card>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["SKU", "Name", "Family", "Net mass", "Units per box", "Shelf life", "On hand", "Released (usable)"]}>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td className="font-mono font-semibold">{p.skuCode}</Td>
                  <Td>{p.name}</Td>
                  <Td>{p.family}</Td>
                  <Td className="whitespace-nowrap">{fmtQty(p.unitNetMassG, "g", 0)}</Td>
                  <Td>{p.unitsPerBox}</Td>
                  <Td className="whitespace-nowrap">{p.shelfLifeDays} days</Td>
                  <Td className="whitespace-nowrap text-right">{fmtQty(p.onHand, "pcs", 0)}</Td>
                  <Td className="whitespace-nowrap text-right">{fmtQty(p.released, "pcs", 0)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
