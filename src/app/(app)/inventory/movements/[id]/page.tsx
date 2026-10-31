import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { REVERSIBLE_MOVEMENT_TYPES, correctionLocations, documentHref, getMovementDetail } from "@/modules/inventory";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { LotStatusChip, MOVEMENT_LABEL, MovementChip, fmtLotQty, placeWords } from "@/ui/inventory/bits";
import { MovementList } from "@/ui/inventory/movement-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ReverseForm } from "./reverse-form";

export const metadata = { title: "Stock change" };

const UNDO_ELSEWHERE: Record<string, string> = {
  receipt: "the delivery's receipt page (undo the receipt there)",
  consumption: "the batch it was used in",
  output: "the batch that made it",
  shipment: "the customer return",
};

export default async function MovementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reversed?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.view")) return <Forbidden what="stock changes" />;
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
  const href = documentHref(m);
  const siteLocations = d.canReverse ? await correctionLocations(ctx, m.siteId) : [];
  const from = d.fromName ?? d.fromCode;
  const to = d.toName ?? d.toCode;
  const what = MOVEMENT_LABEL[m.movementType] ?? m.movementType;
  const canUndoHere = ctx.can("inventory.movement.void");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${what}: ${d.itemName ?? `lot ${d.lotNumber}`}`}
        subtitle={
          <>
            <MovementChip type={m.movementType} /> {fmtLotQty(m.qtyBase, m.baseUom)} · {fmtDateTime(m.postedAt)} · <RecordNo>{d.lotNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <LinkButton href={`/inventory/${m.lotId}`} variant="secondary">Open this lot</LinkButton>
              <LinkButton href={`/inventory/stock-card/${m.lotId}`} variant="secondary">History of this lot</LinkButton>
              {href && <LinkButton href={href} variant="secondary">Open the paper it came from</LinkButton>}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one stock change: what moved, how much, from which shelf to which, and who saved it. Stock changes are never edited; a mistake is undone and the undo stays on record.</PageIntro>

      {reversed && <Banner tone="ok" title="Undone (kept on record)">The stock is back where it was. The undo is listed below.</Banner>}
      {d.reversedBy ? (
        <NextStep text="This stock change was undone. Nothing more to do." />
      ) : m.reversalOfId ? (
        <NextStep text="This is an undo of an earlier stock change. Nothing more to do." />
      ) : d.canReverse ? (
        <NextStep text="Nothing to do. If this was a mistake, undo it at the bottom of this page." action={{ label: "Undo it", href: "#undo" }} />
      ) : !canUndoHere && (REVERSIBLE_MOVEMENT_TYPES as readonly string[]).includes(m.movementType) ? (
        <NextStep text="Nothing to do." waitingFor="If this was a mistake, ask the warehouse lead or site manager (they can undo it)." />
      ) : (
        <NextStep text="Nothing to do." />
      )}

      <Card>
        <Dl
          items={[
            ["What", <MovementChip key="t" type={m.movementType} />],
            ["How much", <strong key="q">{fmtLotQty(m.qtyBase, m.baseUom)}</strong>],
            ["Where", placeWords(from, to) || "—"],
            ["Lot", <Link key="l" href={`/inventory/${m.lotId}`} className="font-mono text-primary-text hover:underline">{d.lotNumber}</Link>],
            ["Saved by", `${d.postedByName} · ${fmtDateTime(m.postedAt)}`],
            ["Why", m.reason ?? "—"],
            ["Now", d.reversedBy ? <Chip key="r" tone="warn">Undone</Chip> : m.reversalOfId ? <Chip key="r" tone="info">This is an undo</Chip> : <Chip key="r" tone="ok">Saved to stock</Chip>],
          ]}
        />
        <div className="mt-3">
          <MoreDetails>
            <Dl
              items={[
                ["Typed in as", m.qtyEntered ? `${m.qtyEntered} ${m.enteredUom}` : "—"],
                ["Shelf codes", `${d.fromCode ?? "—"} → ${d.toCode ?? "—"}`],
                ["Lot was then", m.qualityStatusAtPosting ? <LotStatusChip key="s" status={m.qualityStatusAtPosting} /> : "not recorded"],
                ["Paper it came from", href ? <Link key="h" className="text-primary-text hover:underline" href={href}>{m.sourceDocumentNumber}</Link> : (m.sourceDocumentNumber ?? m.sourceDocumentType ?? "—")],
                ["Undo group", m.correlationId ? m.correlationId.slice(0, 8) : "—"],
              ]}
            />
          </MoreDetails>
        </div>
      </Card>

      {d.related.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[16px] font-semibold">Undo and fix for this stock change</h2>
          <MovementList
            showItem={false}
            label="Undo and fix rows"
            rows={d.related.map((r) => ({ ...r.m, fromCode: r.fromCode, toCode: r.toCode, fromName: r.fromName, toName: r.toName, postedBy: r.postedByName }))}
          />
        </section>
      )}

      {canUndoHere && (
        <Card id="undo">
          <CardTitle>Was this a mistake?</CardTitle>
          {d.canReverse ? (
            <ReverseForm
              movementId={m.id}
              idempotencyKey={randomUUID()}
              summary={`${fmtLotQty(m.qtyBase, m.baseUom)} of lot ${d.lotNumber} ${placeWords(to, from)}`.trim()}
              baseUom={m.baseUom}
              canReplace={ctx.can("inventory.movement.post") && m.movementType === "transfer"}
              locations={siteLocations}
              defaults={{ fromId: m.fromLocationId, qty: m.qtyBase }}
            />
          ) : (
            <p className="text-[14px] text-fg-2">
              {d.reversedBy
                ? "It has already been undone."
                : m.movementType === "reversal"
                  ? "An undo cannot be undone again. Save a new stock change instead (for example move it back)."
                  : `This kind of stock change is fixed from ${UNDO_ELSEWHERE[m.movementType] ?? "the paper it came from"}.`}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
