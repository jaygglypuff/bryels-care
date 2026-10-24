import Link from "next/link";
import { Help } from "@/ui/help/help";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { db } from "@/db/client";
import { reasonCodeOptions } from "@/modules/masterdata";
import { getCount, type CountDetail } from "@/modules/inventory/counts";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { cancelCountAction, postCountAction, releaseCountAction, submitCountAction } from "../actions";
import { ApproveForm, CaptureForm, RecountForm, RejectLinesForm } from "../count-forms";
import { CountStatusChip } from "../status";

export const metadata = { title: "Stock count" };

const q = (v: string | null | undefined) => (v === null || v === undefined ? "—" : new Decimal(v).toString());

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
  const canApprove = ctx.can("inventory.stock_count.approve") && !c.isCounter;
  const label = (l: CountDetail["lines"][number]) => (l.isUnlabelled ? `Unlabelled at ${l.locationCode}: ${l.description}` : `${l.locationCode} · ${l.lotNumber} · ${l.itemName}`);
  const variant = c.lines.filter((l) => !l.isUnlabelled && l.variance !== null && !new Decimal(l.variance).isZero());
  const recountLines = c.lines.filter((l) => l.lineStatus === "recount_required");
  const firstStepDone = c.status === "pending_approval";

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.countNumber}
        subtitle={
          <>
            <Link href="/inventory/counts" className="text-primary-text hover:underline">Stock counts</Link> · {c.countKind} · {c.isBlind ? "blind" : "not blind"} · {c.scope.map((s) => s.code).join(", ")}
          </>
        }
        actions={
          <>
            <Help screen="inventory.count" />
            <CountStatusChip status={c.status} />
            <LinkButton href={`/inventory/counts/${c.id}/sheet`} variant="secondary" size="sm" target="_blank">Count sheet</LinkButton>
          </>
        }
      />
      {["in_progress", "counted", "recount", "pending_approval", "approved"].includes(c.status) && (
        <Banner tone="warn" title="Locations frozen">Nothing can move in or out of {c.scope.map((s) => s.code).join(", ")} until this count is posted or cancelled.</Banner>
      )}
      {c.status === "cancelled" && <Banner tone="info" title="Cancelled">{c.cancelReason}</Banner>}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>Progress</CardTitle>
          <p className="font-display text-[28px] font-semibold tabular">
            {c.progress.locationsCounted} of {c.progress.locations} locations
          </p>
          <p className="text-[13px] text-muted">{c.progress.linesCounted} of {c.progress.lines} lines counted</p>
          <div className="mt-4">
            <Dl
              items={[
                ["Counters", c.counters.map((u) => u.name).join(", ") || "Anyone with count rights"],
                ["Scheduled", fmtDate(c.scheduledFor)],
                ["Frozen at", fmtDateTime(c.frozenAt)],
                ["Submitted", fmtDateTime(c.submittedAt)],
                ["Approved", fmtDateTime(c.approvedAt)],
                ["Posted", fmtDateTime(c.postedAt)],
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardTitle>Next step</CardTitle>
          <div className="flex flex-col gap-3">
            {c.status === "planned" && ctx.can("inventory.stock_count.create") && (
              <CommandForm action={releaseCountAction.bind(null, c.id)} label="Release and freeze" variant="cta" confirmText="Release the count? Expected quantities are snapshotted now and the locations are frozen." />
            )}
            {c.status === "in_progress" && canCount && <CommandForm action={submitCountAction.bind(null, c.id)} label="Submit count sheet" variant="cta" confirmText="Submit the count sheet? Every expected line must be counted (enter 0 if nothing is there)." />}
            {c.status === "recount" && <p className="text-[13px]">Lines above the recount threshold need a blind recount by a counter who did not count them.</p>}
            {(c.status === "counted" || c.status === "pending_approval") && !canApprove && <p className="text-[13px] text-muted">Waiting for variance approval by a site manager who did not count.</p>}
            {c.status === "approved" && ctx.can("inventory.stock_count.post") && (
              <CommandForm action={postCountAction.bind(null, c.id, randomUUID())} label="Post adjustments" variant="cta" confirmText="Post the approved variances as adjustment movements and unfreeze the locations?" />
            )}
            {c.status === "posted" && <p className="text-[13px] text-muted">Posted. Adjustments link to this count in the ledger.</p>}
            {!["posted", "cancelled"].includes(c.status) && ctx.can("inventory.stock_count.approve") && (
              <CommandForm action={cancelCountAction.bind(null, c.id)} label="Cancel count" variant="secondary" reason={{ label: "Reason for cancelling", placeholder: "e.g. urgent issue needed from these locations" }} />
            )}
          </div>
        </Card>
      </div>

      {c.status === "in_progress" && canCount && (
        <Card>
          <CardTitle>Count</CardTitle>
          <CaptureForm countId={c.id} locations={c.scope.map((s) => ({ id: s.id, code: s.code, done: c.lines.filter((l) => l.locationId === s.id).every((l) => l.counted) && c.lines.some((l) => l.locationId === s.id) }))} />
        </Card>
      )}

      {c.status === "recount" && recountLines.length > 0 && (
        <Card>
          <CardTitle>Recount (blind)</CardTitle>
          <div className="flex flex-col gap-4">
            {recountLines.map((l) =>
              l.countedByMe ? (
                <p key={l.id} className="text-[13px] text-muted">{label(l)}: you counted this line, so a different counter must recount it.</p>
              ) : ctx.can("inventory.stock_count.submit") ? (
                <RecountForm key={l.id} countId={c.id} lineId={l.id} label={label(l)} />
              ) : null,
            )}
          </div>
        </Card>
      )}

      {(c.status === "counted" || c.status === "pending_approval") && canApprove && (
        <Card>
          <CardTitle>{firstStepDone ? "Second approval" : "Variance review"}</CardTitle>
          {variant.length === 0 ? (
            <p className="mb-3 text-[13px]">No variances. Approve to close the count with no adjustments.</p>
          ) : null}
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
        <CardTitle>{c.reveal ? "Variance report" : "Lines (blind)"}</CardTitle>
        {c.lines.length === 0 ? (
          <EmptyState title={c.status === "planned" ? "Not released yet" : "No lines"}>{c.status === "planned" ? "Lines are created from the stock at release time." : "These locations held no stock at release."}</EmptyState>
        ) : (
          <Table head={c.reveal ? ["Location", "Lot / item", "Expected", "Count (by)", "Recount (by)", "Variance", "Reason", "Adjusted"] : ["Location", "Lot / item", "Counted"]}>
            {c.lines.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono">{l.locationCode}</Td>
                <Td>
                  {l.isUnlabelled ? <><Chip tone="warn">Unlabelled</Chip> {l.description}</> : <><span className="font-mono">{l.lotNumber}</span> <span className="text-muted">· {l.itemName}</span>{l.isUnexpected && <> <Chip tone="info">found</Chip></>}</>}
                </Td>
                {c.reveal ? (
                  <>
                    <Td>{q(l.expected)}</Td>
                    <Td>{l.firstCount ? `${q(l.firstCount.qty)} (${l.firstCount.by})` : "—"}</Td>
                    <Td>{l.recount ? `${q(l.recount.qty)} (${l.recount.by})` : "—"}</Td>
                    <Td className="font-semibold">{q(l.variance)}{l.autoApproved ? " (auto)" : ""}</Td>
                    <Td>{l.reasonCode?.replace(/_/g, " ") ?? "—"}</Td>
                    <Td>{l.adjustmentMovementId ? <Chip tone="ok">Posted</Chip> : l.isUnlabelled ? <span className="text-[12px] text-muted">Resolve with a found-stock adjustment</span> : "—"}</Td>
                  </>
                ) : (
                  <Td>{l.entries.length ? `${q(l.entries.at(-1)!.qty)} by you` : l.counted ? "Counted" : "Not yet"}</Td>
                )}
              </tr>
            ))}
          </Table>
        )}
        {c.decisions.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12px] text-muted">
            {c.decisions.map((d, i) => (
              <li key={i}>Step {d.step}: {d.decision} by {d.by}, {fmtDateTime(d.at)}{d.note ? ` — ${d.note}` : ""}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
