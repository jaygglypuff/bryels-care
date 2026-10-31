import Link from "next/link";
import { Help } from "@/ui/help/help";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { CheckCircle2 } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { fmtFriendly } from "@/lib/units";
import { db } from "@/db/client";
import { reasonCodeOptions } from "@/modules/masterdata";
import { getCount, type CountDetail } from "@/modules/inventory/counts";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { cancelCountAction, postCountAction, releaseCountAction, submitCountAction } from "../actions";
import { ApproveForm, RecountForm, RejectLinesForm, ShelfCountForm } from "../count-forms";
import { CountStatusChip } from "../status";

export const metadata = { title: "Stock count" };

const q = (v: string | null | undefined) => (v === null || v === undefined ? "—" : new Decimal(v).toString());
/** Friendly amount ("60 kg") when the unit is known; differences keep their sign. */
const amt = (v: string | null | undefined, uom: string | null, signed = false) => {
  if (v === null || v === undefined) return "—";
  if (!uom) return q(v);
  const d = new Decimal(v);
  return `${d.isNeg() ? "−" : signed && !d.isZero() ? "+" : ""}${fmtFriendly(d.abs(), uom)}`;
};

/**
 * One stock count (W03; usability test 2026-10-30): start the count with an on-page question, walk
 * shelf by shelf ("Shelf B-01: scan each sack and type how much"), a progress bar, and "Finish count"
 * at the bottom after the shelves. Statuses and words are plain; the stored codes are unchanged.
 */
export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.stock_count.view")) return <Forbidden what="stock counts" />;
  const { id } = await params;
  let c: CountDetail;
  try {
    c = await getCount(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const canCount = ctx.can("inventory.stock_count.submit") && (c.counters.length === 0 || c.isCounter);
  const canApprove = c.canApproveVariances;
  const label = (l: CountDetail["lines"][number]) => (l.isUnlabelled ? `No label at ${l.locationCode}: ${l.description}` : `${l.locationCode} · ${l.lotNumber} · ${l.itemName}`);
  const variant = c.lines.filter((l) => !l.isUnlabelled && l.variance !== null && !new Decimal(l.variance).isZero());
  const recountLines = c.lines.filter((l) => l.lineStatus === "recount_required");
  const firstStepDone = c.status === "pending_approval";
  const shelves = c.scope.map((s) => s.code).join(", ");
  const pct = c.progress.lines > 0 ? Math.round((c.progress.linesCounted / c.progress.lines) * 100) : 0;
  const counting = c.status === "in_progress" && canCount;

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.countNumber}
        subtitle={
          <>
            <Link href="/inventory/counts" className="text-primary-text hover:underline">Stock counts</Link> · {c.countKind === "cycle" ? "a few shelves" : c.countKind} ·{" "}
            {c.isBlind ? "count without seeing the expected amount" : "expected amounts shown"} · {shelves}
          </>
        }
        actions={
          <>
            <Help screen="inventory.count" />
            <CountStatusChip status={c.status} />
            <LinkButton href={`/inventory/counts/${c.id}/sheet`} variant="secondary" size="sm" target="_blank">Paper count sheet</LinkButton>
          </>
        }
      />
      {["in_progress", "counted", "recount", "pending_approval", "approved"].includes(c.status) && (
        <Banner tone="warn" title="Shelves locked">Nobody can move stock on {shelves} until this count is saved or cancelled.</Banner>
      )}
      {c.status === "cancelled" && <Banner tone="info" title="Cancelled">{c.cancelReason}</Banner>}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>How far are we?</CardTitle>
          <p className="font-display text-[24px] font-semibold tabular">
            {c.progress.linesCounted} of {c.progress.lines} counted
          </p>
          <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Count progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-testid="count-progress">
            <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            {c.progress.locationsCounted} of {c.progress.locations} {c.progress.locations === 1 ? "shelf" : "shelves"} done
          </p>
          <div className="mt-4">
            <Dl
              items={[
                ["Who counts", c.counters.map((u) => u.name).join(", ") || "Anyone with count rights"],
                ["Day", fmtDate(c.scheduledFor)],
                ["Started", fmtDateTime(c.frozenAt)],
                ["Finished", fmtDateTime(c.submittedAt)],
                ["Approved", fmtDateTime(c.approvedAt)],
                ["Saved", fmtDateTime(c.postedAt)],
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardTitle>Next step</CardTitle>
          <div className="flex flex-col gap-3">
            {c.status === "planned" && ctx.can("inventory.stock_count.create") && (
              <CommandForm action={releaseCountAction.bind(null, c.id)} label="Start count" variant="cta" size="lg" confirmText="Start count? Nobody can move stock on these shelves until you finish." confirmLabel="Yes, start the count" />
            )}
            {c.status === "planned" && !ctx.can("inventory.stock_count.create") && <p className="text-[13px] text-muted">Your manager starts this count.</p>}
            {counting && <p className="text-[14px]">Go shelf by shelf below. When every sack is counted, tap <strong>Finish count</strong> at the bottom.</p>}
            {c.status === "recount" && <p className="text-[13px]">Some lines are very different. Someone who did not count them must count them again.</p>}
            {(c.status === "counted" || c.status === "pending_approval") && !canApprove && <p className="text-[13px] text-muted">Waiting for a manager who did not count to check the differences.</p>}
            {c.status === "approved" && ctx.can("inventory.stock_count.post") && (
              <CommandForm action={postCountAction.bind(null, c.id, randomUUID())} label="Save to stock" variant="cta" confirmText="Save the approved differences to stock? The shelves open again." confirmLabel="Yes, save to stock" />
            )}
            {c.status === "posted" && <p className="text-[13px] text-muted">Saved. The changes are in the history of moves.</p>}
            {!["posted", "cancelled"].includes(c.status) && ctx.can("inventory.stock_count.approve") && (
              <CommandForm action={cancelCountAction.bind(null, c.id)} label="Cancel count" variant="secondary" reason={{ label: "Why cancel?", placeholder: "e.g. we need stock from these shelves now" }} />
            )}
          </div>
        </Card>
      </div>

      {counting && (
        <section aria-label="Count shelf by shelf" className="space-y-4">
          {c.scope.map((s, i) => {
            const lines = c.lines.filter((l) => l.locationId === s.id);
            const done = lines.length > 0 && lines.every((l) => l.counted);
            const firstOpen = c.scope.find((x) => {
              const ls = c.lines.filter((l) => l.locationId === x.id);
              return !(ls.length > 0 && ls.every((l) => l.counted));
            });
            return (
              <Card key={s.id} data-testid={`shelf-${s.code}`}>
                <details open={!done && firstOpen?.id === s.id} className="group">
                  <summary className="flex min-h-[52px] cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-[17px] font-semibold">
                        {i + 1}. Shelf {s.code}: scan each sack and type how much
                      </span>
                      <span className="block text-[13px] text-muted">
                        {s.name} · {lines.filter((l) => l.counted).length} of {lines.length} counted
                      </span>
                    </span>
                    {done ? <Chip tone="ok"><CheckCircle2 size={13} /> Done</Chip> : <span className="text-[13px] font-medium text-primary-text group-open:hidden">Open</span>}
                  </summary>
                  <div className="mt-3">
                    <ShelfCountForm
                      countId={c.id}
                      location={{ id: s.id, code: s.code }}
                      lines={lines.map((l) => ({
                        lotNumber: l.lotNumber,
                        itemName: l.itemName,
                        baseUom: l.baseUom,
                        counted: l.counted,
                        mine: l.entries.filter((e) => e.byId === ctx.userId).length ? amt(l.entries.filter((e) => e.byId === ctx.userId).at(-1)!.qty, l.baseUom) : null,
                        unlabelled: l.isUnlabelled,
                        description: l.description,
                      }))}
                    />
                  </div>
                </details>
              </Card>
            );
          })}
          <Card data-testid="finish-count">
            <CardTitle>All shelves counted?</CardTitle>
            <p className="mb-3 text-[14px] text-fg-2">
              {c.progress.linesCounted < c.progress.lines
                ? `${c.progress.lines - c.progress.linesCounted} still not counted. If a sack is not there, type 0 for it.`
                : "Everything is counted. Tap Finish count."}
            </p>
            <CommandForm action={submitCountAction.bind(null, c.id)} label="Finish count" variant="cta" size="lg" confirmText="Finish the count? Every line must have an amount (type 0 if nothing is there)." confirmLabel="Yes, finish" />
          </Card>
        </section>
      )}

      {c.status === "recount" && recountLines.length > 0 && (
        <Card>
          <CardTitle>Count again (without seeing the earlier amount)</CardTitle>
          <div className="flex flex-col gap-4">
            {recountLines.map((l) =>
              l.countedByMe ? (
                <p key={l.id} className="text-[13px] text-muted">{label(l)}: you counted this line, so someone else must count it again.</p>
              ) : ctx.can("inventory.stock_count.submit") ? (
                <RecountForm key={l.id} countId={c.id} lineId={l.id} label={label(l)} baseUom={l.baseUom} />
              ) : null,
            )}
          </div>
        </Card>
      )}

      {(c.status === "counted" || c.status === "pending_approval") && canApprove && (
        <Card>
          <CardTitle>{firstStepDone ? "Second OK" : "Check the differences"}</CardTitle>
          {variant.length === 0 ? <p className="mb-3 text-[13px]">No differences. Approve to close the count without changing stock.</p> : null}
          <ApproveForm
            countId={c.id}
            step={firstStepDone ? 2 : 1}
            reasons={await reasonCodeOptions(db, ctx.organizationId, "count_variance")}
            lines={variant.map((l) => ({
              id: l.id,
              label: label(l),
              expected: q(l.expected),
              first: q(l.firstCount?.qty),
              recount: l.recount ? q(l.recount.qty) : null,
              final: q(l.final),
              variance: q(l.variance),
              pct: l.variancePct,
              reasonCode: l.reasonCode,
              auto: l.autoApproved,
              uom: l.baseUom ?? "",
            }))}
          />
          {variant.length > 0 && (
            <div className="mt-3">
              <RejectLinesForm countId={c.id} lines={variant.map((l) => ({ id: l.id, label: label(l) }))} />
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardTitle>{c.reveal ? "Differences" : "Lines (expected amounts hidden)"}</CardTitle>
        {c.lines.length === 0 ? (
          <EmptyState title={c.status === "planned" ? "Not started yet" : "No lines"}>{c.status === "planned" ? "The list of sacks is made when the count starts." : "These shelves held no stock when the count started."}</EmptyState>
        ) : (
          <Table head={c.reveal ? ["Shelf", "Lot / item", "Expected", "Counted (by)", "Counted again (by)", "Difference", "Reason", "Saved"] : ["Shelf", "Lot / item", "Counted"]}>
            {c.lines.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono">{l.locationCode}</Td>
                <Td>
                  {l.isUnlabelled ? (
                    <>
                      <Chip tone="warn">No label</Chip> {l.description}
                    </>
                  ) : (
                    <>
                      <span className="font-mono">{l.lotNumber}</span> <span className="text-muted">· {l.itemName}</span>
                      {l.isUnexpected && (
                        <>
                          {" "}
                          <Chip tone="info">found</Chip>
                        </>
                      )}
                    </>
                  )}
                </Td>
                {c.reveal ? (
                  <>
                    <Td>{amt(l.expected, l.baseUom)}</Td>
                    <Td>{l.firstCount ? `${amt(l.firstCount.qty, l.baseUom)} (${l.firstCount.by})` : "—"}</Td>
                    <Td>{l.recount ? `${amt(l.recount.qty, l.baseUom)} (${l.recount.by})` : "—"}</Td>
                    <Td className="font-semibold">
                      {amt(l.variance, l.baseUom, true)}
                      {l.autoApproved ? " (small, approved by the rule)" : ""}
                    </Td>
                    <Td>{l.reasonCode?.replace(/_/g, " ") ?? "—"}</Td>
                    <Td>{l.adjustmentMovementId ? <Chip tone="ok">Saved</Chip> : l.isUnlabelled ? <span className="text-[12px] text-muted">A manager adds it with a found-stock fix</span> : "—"}</Td>
                  </>
                ) : (
                  <Td>{l.entries.length ? `${amt(l.entries.at(-1)!.qty, l.baseUom)} by you` : l.counted ? "Counted" : "Not yet"}</Td>
                )}
              </tr>
            ))}
          </Table>
        )}
        {c.decisions.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12px] text-muted">
            {c.decisions.map((d, i) => (
              <li key={i}>
                Step {d.step}: {d.decision} by {d.by}, {fmtDateTime(d.at)}
                {d.note ? ` — ${d.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
