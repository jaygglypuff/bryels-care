import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getHold } from "@/modules/inventory/holds";
import { Card, CardTitle, Dl, EmptyState, Field, PageHeader, Select } from "@/ui/core";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Banner } from "@/ui/status";
import { NextStep, PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { HoldChip, QaStatusChip, Timeline, qaWord } from "../../_ui";
import { ActionForm, ReasonField } from "../../../inventory/receive/[grId]/forms";
import { Forbidden } from "../../../forbidden";
import { investigateHoldAction, liftHoldAction } from "../actions";

export const metadata = { title: "Stopped by QA" };

export default async function HoldPage({ params, searchParams }: { params: Promise<{ holdId: string }>; searchParams: Promise<{ placed?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.hold.view")) return <Forbidden what="QA holds" />;
  const { holdId } = await params;
  const { placed } = await searchParams;
  let h: Awaited<ReturnType<typeof getHold>>;
  try {
    h = await getHold(ctx, holdId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const active = h.status !== "closed";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={`Stopped by QA: ${h.lots[0]?.itemName ?? (h.locationName ? `place ${h.locationName}` : "")}${h.lots.length > 1 ? ` and ${h.lots.length - 1} more` : ""}`}
        subtitle={
          <>
            <Link href="/quality/holds" className="text-primary-text hover:underline">Stopped by QA</Link> · {h.lotNumber ? `lot ${h.lotNumber}` : `place ${h.locationCode}`} · <RecordNo>{h.holdNumber}</RecordNo> · <HoldChip status={h.status} />
          </>
        }
      />
      <PageIntro>This screen is for QA: see what is stopped and why, and let it go (or say not OK) when QA has finished looking.</PageIntro>
      {active &&
        (h.can.lift ? (
          <NextStep text="Next: when QA has finished looking, let it go or say not OK." action={{ label: "Decide now", href: "#lift" }} />
        ) : (
          <NextStep text="The lots stay stopped." waitingFor={h.can.liftBlockedReason ? "Waiting for a second QA person: you stopped it, so someone else lets it go." : "Waiting for QA to let it go."} />
        ))}
      {placed && <Banner tone="hold" title="Stopped">{h.lots.length} lot(s) are stopped. Move them to the hold area; another QA person lets them go.</Banner>}
      {active && h.locationCode && <Banner tone="warn" title={`Place ${h.locationCode} is blocked`}>Nothing can be put there while it is stopped.</Banner>}

      <Card>
        <CardTitle>Lots that are stopped</CardTitle>
        {h.lots.length === 0 ? (
          <EmptyState title="No lots were stopped">The place was empty when it was stopped.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {h.lots.map((l) => (
              <li key={l.lotId} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/quality/lots/${l.lotId}`} className="font-medium text-primary-text hover:underline">
                    {l.itemName}
                  </Link>
                  <span className="font-mono text-[12px] text-muted">{l.lotNumber}</span>
                  <QaStatusChip status={l.qualityStatus} />
                </span>
                <span className="text-[13px] text-fg-2">
                  {fmtLotQty(l.onHand, l.baseUom)} · before: {qaWord(l.previousStatus)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Why it was stopped</CardTitle>
        <Dl
          items={[
            ["Why", `${h.reasonLabel}: ${h.reason}`],
            ["Stopped by", `${h.openedByName}, ${fmtDateTime(h.openedAt)}`],
            ["Outcome", h.resolution ? `${h.resolution === "released" ? "Let go" : "Not OK"} · ${h.closeReason} (${h.closedByName}, ${fmtDateTime(h.closedAt)})` : "—"],
          ]}
        />
        <h3 className="mt-4 text-[14px] font-semibold">What happened</h3>
        <div className="mt-2">
          <Timeline rows={h.timeline} word={(s) => ({ open: "stopped", investigating: "QA looking into it", closed: "no longer stopped" })[s] ?? s} />
        </div>
      </Card>

      {h.can.investigate && (
        <Card>
          <CardTitle>QA is looking into it</CardTitle>
          <ActionForm action={investigateHoldAction} hidden={{ holdId: h.id }} submit="Save: QA is looking into it" variant="secondary">
            <ReasonField id="investigate-note" name="note" label="What is QA checking?" placeholder="e.g. supplier asked for photos" />
          </ActionForm>
        </Card>
      )}
      {active && (h.can.lift || h.can.liftBlockedReason) && (
        <Card>
          <span id="lift" className="block scroll-mt-24" />
          <CardTitle>Let it go, or not OK</CardTitle>
          {h.can.liftBlockedReason ? (
            <p className="text-[13px] text-muted">{h.can.liftBlockedReason}</p>
          ) : (
            <ActionForm action={liftHoldAction} hidden={{ holdId: h.id }} submit="Save the decision" variant="cta" confirm="Save this QA decision for every lot?">
              <Field label="Decision" htmlFor="resolution">
                <Select id="resolution" name="resolution" defaultValue="released">
                  <option value="released">Let it go: each lot goes back to how it was before (waiting for QA check stays waiting)</option>
                  <option value="rejected">Not OK – don&apos;t use: every lot</option>
                </Select>
              </Field>
              <ReasonField id="lift-reason" label="Why?" placeholder="e.g. QA checked; the contents are fine" />
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
