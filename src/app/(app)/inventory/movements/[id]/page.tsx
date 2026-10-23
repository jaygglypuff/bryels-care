import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { REVERSIBLE_MOVEMENT_TYPES, correctionLocations, documentHref, getMovementDetail } from "@/modules/inventory";
import { Card, CardTitle, Dl, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { MOVEMENT_LABEL, fmtLotQty } from "@/ui/inventory/bits";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ReverseForm } from "./reverse-form";

export const metadata = { title: "Stock movement" };

export default async function MovementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reversed?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.view")) return <Forbidden what="the stock ledger" />;
  const { id } = await params;
  const { reversed } = await searchParams;
  let d: Awaited<ReturnType<typeof getMovementDetail>>;
  try {
    d = await getMovementDetail(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const m = d.m;
  const ref = m.sourceDocumentNumber ?? m.id.slice(0, 8);
  const href = documentHref(m);
  const siteLocations = d.canReverse ? await correctionLocations(ctx, m.siteId) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${MOVEMENT_LABEL[m.movementType] ?? m.movementType} · ${ref}`}
        subtitle={`Posted ${fmtDateTime(m.postedAt)} by ${d.postedByName}. Ledger lines are never edited; corrections are reversals.`}
        actions={
          <>
            <Link href={`/inventory/${m.lotId}`} className={buttonClass("secondary", "sm")}>Lot {d.lotNumber}</Link>
            <Link href={`/inventory/stock-card/${m.lotId}`} className={buttonClass("secondary", "sm")}>Stock card</Link>
          </>
        }
      />
      {reversed && <Banner tone="ok" title="Reversal posted">The movement was reversed and balances updated. The correction rows are listed below.</Banner>}
      <Card>
        <Dl
          items={[
            ["Quantity", fmtLotQty(m.qtyBase, m.baseUom)],
            ["Entered as", m.qtyEntered ? `${m.qtyEntered} ${m.enteredUom}` : "—"],
            ["From → to", `${d.fromCode ?? "—"} → ${d.toCode ?? "—"}`],
            ["Lot", d.lotNumber],
            ["Status at posting", m.qualityStatusAtPosting ? <StatusChip key="s" status={m.qualityStatusAtPosting} /> : "not recorded"],
            ["Source document", href ? <Link key="h" className="text-primary-text hover:underline" href={href}>{m.sourceDocumentNumber}</Link> : (m.sourceDocumentNumber ?? m.sourceDocumentType ?? "—")],
            ["Reason", m.reason ?? "—"],
            ["Correction group", m.correlationId ? m.correlationId.slice(0, 8) : "—"],
            ["State", d.reversedBy ? <Chip key="r" tone="warn">Reversed</Chip> : m.reversalOfId ? <Chip key="r" tone="info">Reversal</Chip> : <Chip key="r" tone="ok">Posted</Chip>],
          ]}
        />
      </Card>

      {d.related.length > 0 && (
        <Card>
          <CardTitle>Correction rows</CardTitle>
          <Table head={["When", "Type", "Quantity", "From → to", "By", "Reason"]}>
            {d.related.map((r) => (
              <tr key={r.m.id}>
                <Td className="whitespace-nowrap"><Link className="text-primary-text hover:underline" href={`/inventory/movements/${r.m.id}`}>{fmtDateTime(r.m.postedAt)}</Link></Td>
                <Td>{MOVEMENT_LABEL[r.m.movementType] ?? r.m.movementType}{r.m.reversalOfId === m.id && " (of this line)"}</Td>
                <Td className="text-right">{fmtLotQty(r.m.qtyBase, r.m.baseUom)}</Td>
                <Td className="font-mono text-[12px]">{r.fromCode ?? "—"} → {r.toCode ?? "—"}</Td>
                <Td>{r.postedByName}</Td>
                <Td>{r.m.reason ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {ctx.can("inventory.movement.void") && (
        <Card>
          <CardTitle>Correct this movement</CardTitle>
          {d.canReverse ? (
            <ReverseForm
              movementId={m.id}
              idempotencyKey={randomUUID()}
              summary={`${fmtLotQty(m.qtyBase, m.baseUom)} of lot ${d.lotNumber} from ${d.toCode ?? "—"} to ${d.fromCode ?? "—"}`}
              baseUom={m.baseUom}
              canReplace={ctx.can("inventory.movement.post") && m.movementType === "transfer"}
              locations={siteLocations}
              defaults={{ fromId: m.fromLocationId, qty: m.qtyBase }}
            />
          ) : (
            <p className="text-[14px] text-muted">
              {d.reversedBy
                ? "This movement has already been reversed."
                : m.movementType === "reversal"
                  ? "A reversal cannot itself be reversed; post a new movement instead."
                  : `Only ${REVERSIBLE_MOVEMENT_TYPES.join(", ")} movements are reversed here. A ${m.movementType} is corrected from its source document.`}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
