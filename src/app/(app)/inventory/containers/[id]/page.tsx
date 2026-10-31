import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { Lock } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { boxesAtLocation, getContainer, type ContainerDetail } from "@/modules/inventory/containers";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { BOX_STATUS_WORDS, Expiry, LotStatusChip, MovementChip, fmtLotQty, placeWords } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { boxStatusAction } from "../actions";
import { MergeForm, RepackForm, SplitForm } from "../box-forms";

export const metadata = { title: "Box or sack" };

const OP_TITLE: Record<string, string> = { split: "Split into smaller boxes", merge: "Put together with other boxes", repack: "Repack", seal: "Close the box", reopen: "Open the box again" };
const OP_WORDS: Record<string, string> = { split: "split", merge: "put together", repack: "repacked", pack: "packed" };

/**
 * One box or sack (grade-5, ADR-088): what is inside first, one next step, the rest of the box actions in
 * ⋯ More (each still decided by the server: boxAllowedActions). History as plain lists.
 */
export default async function BoxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ op?: string; created?: string; merged?: string; repacked?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.view")) return <Forbidden what="boxes and sacks" />;
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
  const contents = box.contents.map((c) => ({ lotId: c.lotId, lotNumber: c.lotNumber, itemName: c.itemName, qty: new Decimal(c.qtyBase).toString(), uom: c.baseUom }));
  // Other boxes on the same shelf, picked by what is inside (merge / repack): no typed box numbers.
  const others =
    (op === "merge" || op === "repack") && box.currentLocationId
      ? (await boxesAtLocation(ctx, box.currentLocationId)).filter((b) => b.id !== box.id).map((b) => ({ number: b.containerNumber, label: b.itemNames ?? "Empty box" }))
      : [];
  const ancestors = box.lineage.filter((l) => l.direction === "ancestor");
  const descendants = box.lineage.filter((l) => l.direction === "descendant");
  const action = (k: string) => box.allowedActions.find((a) => a.key === k && a.allowed);
  const title = [...new Set(box.contents.map((c) => c.itemName))].join(", ") || "Empty box";
  const fresh = sp.created || sp.merged || sp.repacked;
  const label = action("label");
  const move = action("move");
  const seal = action("seal");

  const next = fresh && label ? (
    <NextStep text="Print its label and stick it on the box." action={{ label: "Print box label", href: label.href }} />
  ) : box.frozenBy ? (
    <NextStep text="Its shelf is being counted. Leave it where it is." waitingFor="Waiting for the count to be finished (warehouse lead or site manager)." />
  ) : box.contents.length === 0 ? (
    <NextStep text="This box is empty. Nothing to do." />
  ) : seal ? (
    <NextStep text="When the box is full, close it." action={{ label: "Close the box", href: seal.href }} />
  ) : move ? (
    <NextStep text="If the box goes to another shelf, move it so the system knows where it is." action={{ label: "Move box", href: move.href }} />
  ) : (
    <NextStep text="Nothing to do." />
  );
  const rest = box.allowedActions.filter((a) => !(fresh && a.key === "label") && a.key !== (box.frozenBy || box.contents.length === 0 ? "" : seal ? "seal" : move ? "move" : ""));

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            Box <RecordNo>{box.containerNumber}</RecordNo>
            <Chip tone={box.status === "sealed" ? "ok" : box.status === "open" ? "info" : "neu"}>{BOX_STATUS_WORDS[box.status] ?? box.status}</Chip>
            {box.locationName ? `on ${box.locationName}` : "no shelf yet"}
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              {rest.map((a) =>
                a.allowed ? (
                  <LinkButton key={a.key} href={a.href} variant="secondary">
                    {a.label}
                  </LinkButton>
                ) : (
                  <p key={a.key} className="flex items-start gap-2 text-[13px] text-muted" aria-disabled="true">
                    <Lock size={14} className="mt-0.5 shrink-0" aria-hidden /> <span><span className="font-medium">{a.label}</span>: {a.reason}</span>
                  </p>
                ),
              )}
              {box.status === "empty" && ctx.can("inventory.container.edit") && (
                <CommandForm action={boxStatusAction.bind(null, box.id, "void")} label="Throw away this empty box" variant="secondary" reason={{ label: "Why?", placeholder: "Box was damaged" }} />
              )}
              <LinkButton href="/inventory/containers" variant="ghost">All boxes and sacks</LinkButton>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one box or sack: what is inside, which shelf it is on, and where its stock came from or went.</PageIntro>
      {sp.created && <Banner tone="ok" title="Box made">It has its own number now.</Banner>}
      {sp.merged && <Banner tone="ok" title="Boxes put together">This is the new box; the other boxes are now empty.</Banner>}
      {sp.repacked && <Banner tone="ok" title="Repacked">This box got the repacked stock. Print its label again.</Banner>}
      {box.mismatch && <Banner tone="bad" title="The box holds more than the stock on its shelf">Some stock left this shelf another way (for example used in making). Ask your site manager to count this shelf.</Banner>}
      {next}
      {box.allowedActions.length === 0 && <p className="text-[13px] text-muted">Your job can see this box but not change it.</p>}

      {op && (
        <Card id="op">
          <CardTitle action={<Link href={`/inventory/containers/${box.id}`} className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">Close</Link>}>{OP_TITLE[op]}</CardTitle>
          {op === "split" && <SplitForm containerId={box.id} contents={contents} idempotencyKey={randomUUID()} />}
          {op === "merge" && <MergeForm containerId={box.id} idempotencyKey={randomUUID()} others={others} />}
          {op === "repack" && <RepackForm containerId={box.id} contents={contents} idempotencyKey={randomUUID()} others={others} />}
          {op === "seal" && <CommandForm action={boxStatusAction.bind(null, box.id, "sealed")} label="Close the box" variant="cta" />}
          {op === "reopen" && <CommandForm action={boxStatusAction.bind(null, box.id, "open")} label="Open the box again" variant="cta" reason={{ label: "Why open it?", placeholder: "Repack for a customer order" }} />}
        </Card>
      )}

      <Card>
        <CardTitle>Inside</CardTitle>
        {box.contents.length === 0 ? (
          <EmptyState title="Empty">What was inside went into other boxes (see below).</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            {box.contents.map((c) => (
              <li key={c.lotId}>
                <Link href={`/inventory/${c.lotId}`} className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0">
                    <span className="font-semibold">{c.itemName}</span> <LotStatusChip status={c.qualityStatus} expiresOn={c.expiresOn} />
                    <div className="text-[13px] text-fg-2"><Expiry date={c.expiresOn} compact /> <span className="font-mono text-[12px] text-muted">· {c.lotNumber}</span></div>
                  </div>
                  <span className="font-semibold tabular">{fmtLotQty(c.qtyBase, c.baseUom)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Dl
            items={[
              ["Shelf", box.locationName ?? "—"],
              ["Packed", box.packedAt ? `${fmtDateTime(box.packedAt)}${box.packedByName ? ` by ${box.packedByName}` : ""}` : "—"],
              ["Full?", box.isPartial ? "No, part box (PARTIAL on the label)" : "Yes"],
            ]}
          />
        </div>
      </Card>

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">Came from and went to</h2>
        {box.lineage.length === 0 ? (
          <p className="text-[14px] text-fg-2">Packed straight from loose stock. It was never split, put together or repacked.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
            {[...ancestors, ...descendants].map((l) => {
              const other = l.direction === "ancestor" ? { id: l.parent_id, number: l.parent_number } : { id: l.child_id, number: l.child_number };
              return (
                <li key={l.id}>
                  <Link href={`/inventory/containers/${other.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1 text-[14px]">
                      <span className="font-medium">{l.direction === "ancestor" ? "Came from box" : "Went to box"}</span> <span className="font-mono text-[13px]">{other.number}</span>
                      <span className="block text-[13px] text-fg-2">{OP_WORDS[l.operation] ?? l.operation} · {fmtDate(l.performed_at)} <span className="font-mono text-[12px] text-muted">· {l.lot_number}</span></span>
                    </div>
                    <span className="shrink-0 font-semibold tabular">{fmtLotQty(new Decimal(l.qty_base).toString(), box.contents[0]?.baseUom ?? "")}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">Moves of this box</h2>
        {box.movements.length === 0 ? (
          <p className="text-[14px] text-fg-2">Not moved yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
            {box.movements.map((m) => {
              const meta = (m.meta ?? {}) as { fromCode?: string; toCode?: string };
              return (
                <li key={m.id}>
                  <Link href={`/inventory/movements/${m.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <MovementChip type={m.type} />
                      <p className="mt-0.5 text-[13px] text-fg-2">{placeWords(meta.fromCode, meta.toCode)} · {m.by} · {fmtDateTime(m.postedAt)}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular">{fmtLotQty(m.qtyBase, m.baseUom)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
