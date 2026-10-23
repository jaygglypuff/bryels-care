import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { Lock } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getContainer, type ContainerDetail } from "@/modules/inventory/containers";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Expiry, MOVEMENT_LABEL, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { boxStatusAction } from "../actions";
import { MergeForm, RepackForm, SplitForm } from "../box-forms";

export const metadata = { title: "Box" };

const OP_TITLE: Record<string, string> = { split: "Split this box", merge: "Merge with other boxes", repack: "Repack", seal: "Seal box", reopen: "Reopen box" };

export default async function BoxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ op?: string; created?: string; merged?: string; repacked?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.view")) return <Forbidden what="boxes" />;
  const { id } = await params;
  const sp = await searchParams;
  let box: ContainerDetail;
  try {
    box = await getContainer(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const op = sp.op && box.allowedActions.some((a) => a.key === sp.op && a.allowed) ? sp.op : null;
  const contents = box.contents.map((c) => ({ lotId: c.lotId, lotNumber: c.lotNumber, qty: new Decimal(c.qtyBase).toString(), uom: c.baseUom }));
  const ancestors = box.lineage.filter((l) => l.direction === "ancestor");
  const descendants = box.lineage.filter((l) => l.direction === "descendant");

  return (
    <div className="space-y-5">
      <PageHeader
        title={box.containerNumber}
        subtitle={
          <>
            <Link href="/inventory/containers" className="text-primary-text hover:underline">Boxes</Link> · {box.containerKind} · {box.locationCode ?? "no location"}
          </>
        }
        actions={<Chip tone={box.status === "open" || box.status === "sealed" ? "ok" : "neu"}>{box.status.replace("_", " ")}</Chip>}
      />
      {sp.created && <Banner tone="ok" title="Box created">Print its label and stick it on the box.</Banner>}
      {sp.merged && <Banner tone="ok" title="Boxes merged">This is the new box; the merged boxes are now empty. Print its label.</Banner>}
      {sp.repacked && <Banner tone="ok" title="Repacked">This box received the repacked stock. Reprint its label (reason: repack).</Banner>}
      {box.frozenBy && <Banner tone="warn" title={`Frozen by stock count ${box.frozenBy}`}>Nothing can move in or out of its location until the count is posted or cancelled.</Banner>}
      {box.mismatch && <Banner tone="bad" title="Box contents above recorded stock">Stock left this location by another flow (e.g. production). Ask your site manager for a count of this location.</Banner>}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>Contents</CardTitle>
          {box.contents.length === 0 ? (
            <EmptyState title="Empty box">Its contents were split, merged or repacked into other boxes (see lineage).</EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-[12px] border border-line">
              {box.contents.map((c) => (
                <li key={c.lotId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/inventory/${c.lotId}`} className="font-mono font-semibold text-primary-text hover:underline">{c.lotNumber}</Link>
                    <span className="text-muted"> · {c.itemName} · {c.itemCode}</span>
                    <div className="text-[12px]"><Expiry date={c.expiresOn} compact /></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip status={c.qualityStatus} />
                    <span className="font-semibold tabular">{fmtLotQty(c.qtyBase, c.baseUom)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Dl
              items={[
                ["Location", box.locationCode ? `${box.locationCode} · ${box.locationName}` : "—"],
                ["Packed", box.packedAt ? `${fmtDateTime(box.packedAt)}${box.packedByName ? ` by ${box.packedByName}` : ""}` : "—"],
                ["Partial", box.isPartial ? "Yes (PARTIAL on label)" : "No"],
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardTitle>Actions</CardTitle>
          <div className="flex flex-col gap-2">
            {box.allowedActions.map((a) =>
              a.allowed ? (
                <LinkButton key={a.key} href={a.href} variant={a.key === "move" ? "cta" : "secondary"} target={a.key === "label" ? "_blank" : undefined}>
                  {a.label}
                </LinkButton>
              ) : (
                <div key={a.key} className="flex min-h-[44px] items-start gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[13px] text-muted" aria-disabled="true">
                  <Lock size={14} className="mt-0.5 shrink-0" /> <span><span className="font-medium">{a.label}</span>: {a.reason}</span>
                </div>
              ),
            )}
            {box.allowedActions.length === 0 && <p className="text-[13px] text-muted">Your role can view this box but not change it.</p>}
            {box.status === "empty" && ctx.can("inventory.container.edit") && (
              <CommandForm action={boxStatusAction.bind(null, box.id, "void")} label="Void empty box" variant="secondary" reason={{ label: "Why void it?", placeholder: "Box discarded" }} />
            )}
          </div>
        </Card>
      </div>

      {op && (
        <Card id="op">
          <CardTitle action={<Link href={`/inventory/containers/${box.id}`} className="text-[13px] text-primary-text hover:underline">Close</Link>}>{OP_TITLE[op]}</CardTitle>
          {op === "split" && <SplitForm containerId={box.id} contents={contents} idempotencyKey={randomUUID()} />}
          {op === "merge" && <MergeForm containerId={box.id} idempotencyKey={randomUUID()} />}
          {op === "repack" && <RepackForm containerId={box.id} contents={contents} idempotencyKey={randomUUID()} />}
          {op === "seal" && <CommandForm action={boxStatusAction.bind(null, box.id, "sealed")} label="Seal box" variant="cta" />}
          {op === "reopen" && <CommandForm action={boxStatusAction.bind(null, box.id, "open")} label="Reopen box" variant="cta" reason={{ label: "Why reopen it?", placeholder: "Repack for customer order" }} />}
        </Card>
      )}

      <Card>
        <CardTitle>Lineage</CardTitle>
        {box.lineage.length === 0 ? (
          <EmptyState title="No lineage">This box was packed directly from loose stock and has not been split, merged or repacked.</EmptyState>
        ) : (
          <Table head={["When", "Operation", "From box", "To box", "Lot", "Quantity", ""]}>
            {[...ancestors, ...descendants].map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{fmtDate(l.performed_at)}</Td>
                <Td>{l.operation}</Td>
                <Td><Link href={`/inventory/containers/${l.parent_id}`} className="font-mono text-primary-text hover:underline">{l.parent_number}</Link></Td>
                <Td><Link href={`/inventory/containers/${l.child_id}`} className="font-mono text-primary-text hover:underline">{l.child_number}</Link></Td>
                <Td className="font-mono">{l.lot_number}</Td>
                <Td className="tabular">{new Decimal(l.qty_base).toString()}</Td>
                <Td><Chip tone={l.direction === "ancestor" ? "info" : "neu"}>{l.direction === "ancestor" ? "came from" : "went to"}</Chip></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardTitle>Moves of this box</CardTitle>
        {box.movements.length === 0 ? (
          <EmptyState title="Not moved yet" />
        ) : (
          <Table head={["When", "Type", "Quantity", "From → to", "Document", "By"]}>
            {box.movements.map((m) => {
              const meta = (m.meta ?? {}) as { fromCode?: string; toCode?: string };
              return (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(m.postedAt)}</Td>
                  <Td>{MOVEMENT_LABEL[m.type] ?? m.type}</Td>
                  <Td>{fmtLotQty(m.qtyBase, m.baseUom)}</Td>
                  <Td className="font-mono text-[12px]">{meta.fromCode ?? "—"} → {meta.toCode ?? "—"}</Td>
                  <Td className="font-mono">{m.number ?? "—"}</Td>
                  <Td>{m.by}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
