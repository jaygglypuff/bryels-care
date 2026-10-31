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
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
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
 * One stock count (W03; usability test 2026-10-30; grade-5 ADR-088): one next step by state, shelf by shelf
 * ("Shelf B-01: scan each sack and type how much"), a progress bar, "Finish count" after the shelves. Shelves
 * stay frozen while the count runs; differences need a manager who did not count (and a second OK when the
 * rule asks). Cancel and the paper sheet are in ⋯ More. Statuses and words are plain; stored codes unchanged.
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
  const label = (l: CountDetail["lines"][number]) => (l.isUnlabelled ? `No label on ${l.locationCode}: ${l.description}` : `${l.itemName} on ${l.locationCode} · ${l.lotNumber}`);
  const variant = c.lines.filter((l) => !l.isUnlabelled && l.variance !== null && !new Decimal(l.variance).isZero());
  const recountLines = c.lines.filter((l) => l.lineStatus === "recount_required");
  const firstStepDone = c.status === "pending_approval";
  const shelves = c.scope.map((s) => s.name).join(", ");
  const pct = c.progress.lines > 0 ? Math.round((c.progress.linesCounted / c.progress.lines) * 100) : 0;
  const counting = c.status === "in_progress" && canCount;
  const counters = c.counters.map((u) => u.name).join(", ");
  const locked = ["in_progress", "counted", "recount", "pending_approval", "approved"].includes(c.status);
  const canCancel = !["posted", "cancelled"].includes(c.status) && ctx.can("inventory.stock_count.approve");

  const next = (() => {
    switch (c.status) {
      case "planned":
        return ctx.can("inventory.stock_count.create") ? (
          <NextStep text="Start the count when you are at the shelves (button below). Nobody can move stock on them until you finish." />
        ) : (
          <NextStep text="This count has not started." waitingFor="Waiting for the warehouse lead or site manager to start it." />
        );
      case "in_progress":
        return counting ? (
          <NextStep text={`Count shelf by shelf: ${c.progress.linesCounted} of ${c.progress.lines} done. Then tap Finish count at the bottom.`} action={{ label: "Count the next shelf", href: "#shelves" }} />
        ) : (
          <NextStep text="The shelves are being counted." waitingFor={`Waiting for ${counters || "the counters"} (warehouse) to count every shelf.`} />
        );
      case "recount":
        return ctx.can("inventory.stock_count.submit") && recountLines.some((l) => !l.countedByMe) ? (
          <NextStep text="Some lines are very different. Count them again (you will not see the first amount)." action={{ label: "Count again", href: "#recount" }} />
        ) : (
          <NextStep text="Some lines must be counted again." waitingFor="Waiting for someone who did not count them the first time (warehouse)." />
        );
      case "counted":
      case "pending_approval":
        return canApprove ? (
          <NextStep text={firstStepDone ? "Give the second OK for the differences." : "Check the differences and say why each one happened."} action={{ label: firstStepDone ? "Give second OK" : "Check the differences", href: "#check" }} />
        ) : (
          <NextStep text="Counted." waitingFor={firstStepDone ? "Waiting for a second manager (site manager or owner) to give the second OK." : "Waiting for a manager who did not count (site manager) to check the differences."} />
        );
      case "approved":
        return ctx.can("inventory.stock_count.post") ? (
          <NextStep text="The differences are approved. Save them to stock (button below) to open the shelves again." />
        ) : (
          <NextStep text="Approved." waitingFor="Waiting for the site manager to save the differences to stock." />
        );
      case "posted":
        return <NextStep text="Saved to stock. The shelves are open again. Nothing more to do." />;
      case "cancelled":
        return <NextStep text="This count was cancelled. Nothing more to do." />;
      default:
        return null;
    }
  })();
  const doForm =
    c.status === "planned" && ctx.can("inventory.stock_count.create") ? (
      <CommandForm action={releaseCountAction.bind(null, c.id)} label="Start count" variant="cta" size="lg" confirmText="Start count? Nobody can move stock on these shelves until you finish." confirmLabel="Yes, start the count" />
    ) : c.status === "approved" && ctx.can("inventory.stock_count.post") ? (
      <CommandForm action={postCountAction.bind(null, c.id, randomUUID())} label="Save to stock" variant="cta" size="lg" confirmText="Save the approved differences to stock? The shelves open again." confirmLabel="Yes, save to stock" />
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Count: ${shelves || "shelves"}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <RecordNo>{c.countNumber}</RecordNo> <CountStatusChip status={c.status} /> {c.isBlind ? "counters do not see the expected amount" : "expected amounts shown"}
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href={`/inventory/counts/${c.id}/sheet`} variant="secondary" target="_blank">Paper count sheet</LinkButton>
              <Help screen="inventory.count" />
              {canCancel && (
                <div>
                  <p className="mb-2 text-[13px] text-fg-2">Cancelling opens the shelves again. Nothing in stock changes.</p>
                  <CommandForm action={cancelCountAction.bind(null, c.id)} label="Cancel count" variant="secondary" reason={{ label: "Why cancel?", placeholder: "e.g. we need stock from these shelves now" }} />
                </div>
              )}
              <LinkButton href="/inventory/counts" variant="ghost">All counts</LinkButton>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one stock count: start it, count each shelf, then a manager checks the differences before stock changes.</PageIntro>
      {locked && <Banner tone="warn" title="Shelves locked">Nobody can move stock on {shelves} until this count is saved or cancelled.</Banner>}
      {c.status === "cancelled" && <Banner tone="info" title="Cancelled">{c.cancelReason}</Banner>}
      {next}
      {doForm && (
        <Card id="do">
          {doForm}
        </Card>
      )}

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
        <div className="mt-3">
          <MoreDetails title="Who and when">
            <Dl
              items={[
                ["Who counts", counters || "Anyone who may count"],
                ["Day", fmtDate(c.scheduledFor)],
                ["Started", fmtDateTime(c.frozenAt)],
                ["Finished", fmtDateTime(c.submittedAt)],
                ["Approved", fmtDateTime(c.approvedAt)],
                ["Saved to stock", fmtDateTime(c.postedAt)],
              ]}
            />
          </MoreDetails>
        </div>
      </Card>

      {counting && (
        <section id="shelves" aria-label="Count shelf by shelf" className="space-y-4">
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
        <Card id="recount">
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
        <Card id="check">
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

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">{c.reveal ? "What was counted" : "What was counted (expected amounts hidden)"}</h2>
        {c.lines.length === 0 ? (
          <EmptyState title={c.status === "planned" ? "Not started yet" : "Nothing on these shelves"}>{c.status === "planned" ? "The list of sacks is made when the count starts." : "These shelves held no stock when the count started."}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="Count lines">
            {c.lines.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">
                      {l.isUnlabelled ? <>No label: {l.description}</> : l.itemName}{" "}
                      {l.isUnlabelled && <Chip tone="warn">No label</Chip>}
                      {l.isUnexpected && <Chip tone="info">Found here</Chip>}
                      {l.adjustmentMovementId && <Chip tone="ok"><CheckCircle2 size={13} aria-hidden /> Saved to stock</Chip>}
                    </p>
                    <p className="mt-0.5 text-[13px] text-fg-2">
                      On {l.locationCode}
                      {!l.isUnlabelled && <span className="ml-1 font-mono text-[12px] text-muted">· {l.lotNumber}</span>}
                    </p>
                    {c.reveal && (
                      <p className="mt-0.5 text-[13px] text-fg-2 tabular">
                        Should be {amt(l.expected, l.baseUom)} · counted {l.firstCount ? `${amt(l.firstCount.qty, l.baseUom)} (${l.firstCount.by})` : "—"}
                        {l.recount ? ` · again ${amt(l.recount.qty, l.baseUom)} (${l.recount.by})` : ""}
                        {l.reasonCode ? ` · why: ${l.reasonCode.replace(/_/g, " ")}` : ""}
                        {l.isUnlabelled && !l.adjustmentMovementId ? " · a manager adds it with a found-stock fix" : ""}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-[15px] font-semibold tabular">
                    {c.reveal ? (
                      <>
                        {amt(l.variance, l.baseUom, true)}
                        <span className="block text-[12px] font-normal text-muted">{l.autoApproved ? "small, OK by the rule" : "difference"}</span>
                      </>
                    ) : l.entries.length ? (
                      `${amt(l.entries.at(-1)!.qty, l.baseUom)} by you`
                    ) : l.counted ? (
                      "Counted"
                    ) : (
                      <span className="font-normal text-muted">Not yet</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {c.decisions.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px] text-fg-2">
            {c.decisions.map((d, i) => (
              <li key={i}>
                Step {d.step}: {d.decision} by {d.by}, {fmtDateTime(d.at)}
                {d.note ? ` — ${d.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
