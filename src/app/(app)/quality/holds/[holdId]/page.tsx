import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getHold } from "@/modules/inventory/holds";
import { Card, CardTitle, Dl, EmptyState, Field, PageHeader, Select, Table, Td } from "@/ui/core";
import { fmtLotQty } from "@/ui/inventory/bits";
import { HoldStatusChip } from "@/ui/receiving";
import { Banner, StatusChip } from "@/ui/status";
import { ActionForm, ReasonField } from "../../../inventory/receive/[grId]/forms";
import { Forbidden } from "../../../forbidden";
import { investigateHoldAction, liftHoldAction } from "../actions";

export const metadata = { title: "QA hold" };

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
        title={h.holdNumber}
        subtitle={
          <>
            <Link href="/quality/holds" className="text-primary-text hover:underline">QA holds</Link> · {h.lotNumber ? `lot ${h.lotNumber}` : `location ${h.locationCode}`} · <HoldStatusChip status={h.status} />
          </>
        }
      />
      {placed && <Banner tone="hold" title={`Hold ${h.holdNumber} placed`}>{h.lots.length} lot(s) are on hold. Move them to a hold location; a different QA user lifts the hold.</Banner>}
      {active && h.locationCode && <Banner tone="warn" title={`Location ${h.locationCode} is blocked`}>No stock can be put away into it while the hold is open.</Banner>}

      <Card>
        <CardTitle>Affected lots</CardTitle>
        {h.lots.length === 0 ? (
          <EmptyState title="No lots were affected">The location had no stock that could be put on hold when the hold was placed.</EmptyState>
        ) : (
          <Table head={["Lot", "Item", "On hand", "Before hold", "Now"]}>
            {h.lots.map((l) => (
              <tr key={l.lotId}>
                <Td><Link href={`/inventory/${l.lotId}`} className="font-mono text-primary-text hover:underline">{l.lotNumber}</Link></Td>
                <Td>{l.itemCode} · {l.itemName}</Td>
                <Td className="tabular">{fmtLotQty(l.onHand, l.baseUom)}</Td>
                <Td><StatusChip status={l.previousStatus} /></Td>
                <Td><StatusChip status={l.qualityStatus} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardTitle>Hold</CardTitle>
        <Dl
          items={[
            ["Reason", `${h.reasonLabel}: ${h.reason}`],
            ["Opened", `${fmtDateTime(h.openedAt)} by ${h.openedByName}`],
            ["Resolution", h.resolution ? `${h.resolution} · ${h.closeReason} (${h.closedByName}, ${fmtDateTime(h.closedAt)})` : "—"],
          ]}
        />
        <h3 className="mt-4 text-[14px] font-semibold">Timeline</h3>
        <ol className="mt-2 space-y-1 text-[13px]">
          {h.timeline.map((t, i) => (
            <li key={i}>
              {fmtDateTime(t.at)} · {t.from ? `${t.from} → ` : ""}
              {t.to} · {t.by}
              {t.reason ? ` · ${t.reason}` : ""}
            </li>
          ))}
        </ol>
      </Card>

      {h.can.investigate && (
        <Card>
          <CardTitle>Mark as under investigation</CardTitle>
          <ActionForm action={investigateHoldAction} hidden={{ holdId: h.id }} submit="Mark investigating" variant="secondary">
            <ReasonField id="investigate-note" name="note" label="Note" placeholder="e.g. supplier asked for photos" />
          </ActionForm>
        </Card>
      )}
      {active && (h.can.lift || h.can.liftBlockedReason) && (
        <Card>
          <CardTitle>Lift hold</CardTitle>
          {h.can.liftBlockedReason ? (
            <p className="text-[13px] text-muted">{h.can.liftBlockedReason}</p>
          ) : (
            <ActionForm action={liftHoldAction} hidden={{ holdId: h.id }} submit="Lift hold" variant="cta" confirm="Lift this hold and record the closing dispositions?">
              <Field label="Resolution" htmlFor="resolution">
                <Select id="resolution" name="resolution" defaultValue="released">
                  <option value="released">Released: lots return to their status before the hold (quarantine stays quarantine)</option>
                  <option value="rejected">Rejected: every lot is rejected</option>
                </Select>
              </Field>
              <ReasonField id="lift-reason" placeholder="e.g. investigation closed; contents unaffected" />
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
