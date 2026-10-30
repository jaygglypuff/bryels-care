import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { MOVEMENT_TYPES, documentHref, listMovements } from "@/modules/inventory/movements";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { MOVEMENT_LABEL, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Stock movements" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.view")) return <Forbidden what="the stock ledger" />;
  const { type } = await searchParams;
  const active = type && (MOVEMENT_TYPES as string[]).includes(type) ? type : undefined;
  const rows = await listMovements(ctx, { type: active });

  return (
    <div className="space-y-5">
      <PageHeader title="Stock movements" subtitle={`${ctx.currentSite.code} · every stock change, newest first (last 200). A mistake is undone with a reversal; nothing is ever edited.`} />
      <nav aria-label="Movement type" className="flex flex-wrap gap-2">
        {[undefined, ...MOVEMENT_TYPES].map((t) => (
          <Link
            key={t ?? "all"}
            href={t ? `/inventory/movements?type=${t}` : "/inventory/movements"}
            aria-current={active === t ? "page" : undefined}
            className={cx(
              "inline-flex min-h-[36px] items-center rounded-full border px-3 text-[13px]",
              active === t ? "border-primary bg-primary-soft font-semibold text-primary-text" : "border-line bg-surface text-fg-2 hover:bg-surface-2",
            )}
          >
            {t ? MOVEMENT_LABEL[t] : "All"}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={active ? `No ${MOVEMENT_LABEL[active].toLowerCase()} movements` : "No stock movements yet"} action={active ? <LinkButton href="/inventory/movements" variant="secondary">Show all</LinkButton> : undefined}>
            Receipts, transfers, production consumption and output, and shipments are listed here as they are posted.
          </EmptyState>
        ) : (
          <Table head={["When", "Type", "Lot", "Item", "Quantity", "From → to", "Document", "By"]}>
            {rows.map((m) => {
              const href = documentHref(m);
              return (
                <tr key={m.id} className="hover:bg-surface-2">
                  <Td className="whitespace-nowrap"><Link href={`/inventory/movements/${m.id}`} className="text-primary-text hover:underline">{fmtDateTime(m.postedAt)}</Link></Td>
                  <Td>{MOVEMENT_LABEL[m.movementType] ?? m.movementType}{m.reason && <div className="max-w-[220px] truncate text-[12px] text-muted" title={m.reason}>{m.reason}</div>}</Td>
                  <Td><Link href={`/inventory/${m.lotId}`} className="font-mono font-semibold text-primary-text hover:underline">{m.lotNumber}</Link></Td>
                  <Td>{m.itemName ?? m.productName}<div className="text-[12px] text-muted">{m.itemCode ?? m.productSku}</div></Td>
                  <Td className="whitespace-nowrap text-right font-medium">{fmtLotQty(m.qtyBase, m.baseUom)}</Td>
                  <Td className="whitespace-nowrap font-mono text-[12px]">{m.fromCode ?? "—"} → {m.toCode ?? "—"}</Td>
                  <Td>{href ? <Link href={href} className="text-primary-text hover:underline">{m.sourceDocumentNumber}</Link> : m.sourceDocumentNumber ?? "—"}</Td>
                  <Td>{m.postedBy}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
