import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { daysUntil, fmtDate, fmtDateTime } from "@/lib/qty";
import { getLotDisposition } from "@/modules/quality/dispositions";
import { issueDownloadUrl, listLotDocuments } from "@/modules/inventory/receiving-documents";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DecisionChip, DeviationStatusChip, InspectionStatusChip, QaStatusChip, Transition, fmtLotQty, statusTone } from "../../_ui";
import { StartInspectionButton } from "../../w2c-forms";
import { decideLotAction } from "../../actions";
import { DecisionForm, type DecisionOption } from "../../decision-form";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

const BANNER: Record<string, { title: string; body: string }> = {
  quarantine: { title: "Waiting for QA check", body: "Nobody can use, set aside or ship this lot until QA says it is OK." },
  on_hold: { title: "Stopped by QA", body: "Nobody can use this lot until QA says it is OK again, or not OK." },
  released: { title: "OK to use", body: "This lot may be used and shipped." },
  rejected: { title: "Not OK – don't use", body: "This lot is blocked; its stock is in the area for things we cannot use." },
  expired: { title: "Expired – don't use", body: "This lot is past its use-by date and cannot be made OK. Say not OK to move it to the area for things we cannot use." },
  recalled: { title: "Recalled – don't use", body: "This lot is blocked by a product recall." },
};

const HINT: Record<string, string> = {
  release: "People may use it from now on.",
  release_from_hold: "People may use it again.",
  hold: "Nobody may use it until QA decides. The stock stays where it is.",
  reject: "All its stock moves to the area for things we cannot use.",
};

export default async function LotDispositionPage({ params }: { params: Promise<{ lotId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="QA lot decisions" />;
  const { lotId } = await params;

  let v: Awaited<ReturnType<typeof getLotDisposition>>;
  try {
    v = await getLotDisposition(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Lot not found" action={<LinkButton href="/quality" variant="secondary">Back to the QA list</LinkButton>}>
          This lot does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const { lot } = v;
  const docs = await Promise.all(
    (await listLotDocuments(ctx, lot.id)).map(async (d) => ({
      ...d,
      href: ctx.can("documents.file_attachment.view") ? ((await issueDownloadUrl(ctx, d.id).catch(() => null))?.url ?? null) : null,
    })),
  );
  const banner = BANNER[lot.qualityStatus] ?? { title: lot.qualityStatus, body: "" };
  const days = daysUntil(lot.expiresOn);
  // Only the choices that fit the lot's status are shown ("OK to use again" only for a lot stopped by QA).
  const fits = (d: string) => (d === "release_from_hold" ? lot.qualityStatus === "on_hold" : d === "release" ? lot.qualityStatus !== "on_hold" : true);
  const options: DecisionOption[] = v.decisions.filter((d) => fits(d.decision)).map((d) => ({
    value: d.decision,
    label: ({ release: "OK to use", release_from_hold: "OK to use again", hold: "Stop it (QA hold)", reject: "Not OK – don't use" } as Record<string, string>)[d.decision] ?? d.label,
    hint: HINT[d.decision],
    blocker: d.blocker,
    danger: d.decision === "reject",
  }));

  return (
    <>
      <PageHeader
        title={v.itemName}
        subtitle={
          <>
            {lot.itemKind === "material" ? "Delivery (material lot)" : "Finished product lot"} <RecordNo>{lot.lotNumber}</RecordNo>
          </>
        }
        actions={
          <>
            <Help screen="quality.release" />
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <LinkButton href={`/inventory/${lot.id}`} variant="secondary">
                  Where this lot is stored
                </LinkButton>
                {ctx.can("quality.genealogy.view") && (
                  <LinkButton href={`/quality/trace?lot=${encodeURIComponent(lot.lotNumber)}`} variant="secondary">
                    Where it came from and where it went
                  </LinkButton>
                )}
                {v.can.raiseDeviation && (
                  <LinkButton href={`/quality/deviations/new?lotId=${lot.id}`} variant="secondary">
                    Report a problem
                  </LinkButton>
                )}
                <LinkButton href="/quality" variant="secondary">
                  Back to the QA list
                </LinkButton>
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>
        This screen is for the QA person: check this lot and say OK to use or not OK.
      </PageIntro>
      <div className="-mt-3 mb-4"><Explain term="lot" /></div>
      {v.pendingBatch ? (
        <NextStep text="This lot gets its OK or not OK together with its batch." action={{ label: "Check the batch", href: `/quality/check/${v.pendingBatch.id}` }} />
      ) : !v.canDecide ? (
        ["quarantine", "on_hold"].includes(lot.qualityStatus) ? <NextStep text="Next: a QA person checks this lot and says OK or not OK." waitingFor="Waiting for QA." /> : null
      ) : options.some((o) => !o.blocker) && ["quarantine", "on_hold", "expired"].includes(lot.qualityStatus) ? (
        <NextStep text={v.expired || lot.qualityStatus === "expired" ? "Next: this lot is past its use-by date. Say not OK (or stop it)." : "Next: look at the papers and the quality check, then decide OK or not OK."} action={{ label: "Decide now", href: "#decide" }} />
      ) : null}
      {!v.canDecide && ["quarantine", "on_hold"].includes(lot.qualityStatus) && (
        <div className="-mt-2 mb-4">
          <WhoCanHelp permission="quality.disposition.approve" siteId={lot.siteId} hideEmails lead="QA people who decide: " />
        </div>
      )}

      <div className="flex flex-col gap-5">
        <Banner tone={statusTone(lot.qualityStatus)} title={banner.title}>
          {banner.body}
        </Banner>
        {v.expired && lot.qualityStatus !== "expired" && (
          <Banner tone="exp" title={`Expiry date passed (${fmtDate(lot.expiresOn)})`}>
            It cannot be made OK to use. Say not OK, or stop it.
          </Banner>
        )}
        {v.pendingBatch && (
          <Banner tone="appr" title={`Made in batch ${v.pendingBatch.number}`}>
            A finished product lot gets its OK or not OK together with its batch.
          </Banner>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle>About this lot</CardTitle>
            <Dl
              items={[
                ["Lot number", lot.lotNumber],
                ["Item", v.itemName],
                ["Status", <QaStatusChip key="s" status={lot.qualityStatus} />],
                ["Use by", <span key="e">{fmtDate(lot.expiresOn)}{days !== null && !v.expired ? <span className="text-muted"> · {days} days</span> : null}</span>],
                ["Made on", fmtDate(lot.manufacturedOn)],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>{lot.itemKind === "material" ? "Delivery" : "Where it was made"}</CardTitle>
            {v.receipt ? (
              <Dl
                items={[
                  ["Supplier", v.receipt.supplierName],
                  ["Amount received", fmtLotQty(v.receipt.qtyReceived, lot.baseUom)],
                  ["Received", `${fmtDateTime(v.receipt.receivedAt)} · ${v.receipt.receivedByName}`],
                  ["Supplier's lot number", lot.supplierLotNumber ?? "—"],
                  ["Delivery papers", `${v.receipt.receiptNumber}${v.receipt.supplierDocumentNumber ? ` · ${v.receipt.supplierDocumentNumber}` : ""}`],
                ]}
              />
            ) : (
              <Dl
                items={[
                  ["Batch", v.sourceBatch ? <Link key="b" className="text-primary-text hover:underline" href={`/quality/batches/${v.sourceBatch.id}`}>{v.sourceBatch.number}</Link> : "—"],
                  ["Batch status", v.sourceBatch ? <QaStatusChip key="bs" status={v.sourceBatch.status} /> : "—"],
                  ["Supplier", lot.supplierName ?? "—"],
                  ["Supplier lot", lot.supplierLotNumber ?? "—"],
                  ["Created by", v.createdByName ?? "—"],
                  ["Created", fmtDateTime(lot.createdAt)],
                ]}
              />
            )}
          </Card>
        </div>

        {lot.itemKind === "material" && (
          <Card>
            <CardTitle>Supplier papers (certificate of analysis, CoA)</CardTitle>
            {docs.length === 0 ? (
              <p className="text-[13px] text-muted">No paper from the supplier is attached to this lot{v.receipt ? ". The warehouse attaches it on the delivery (receiving) screen; ask them" : ""}.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {docs.map((d) => (
                  <li key={d.id}>
                    {d.href ? <a href={d.href} className="font-medium text-primary-text hover:underline">{d.fileName}</a> : <span className="font-medium">{d.fileName}</span>}
                    <span className="text-muted"> · {d.documentKind.toUpperCase()}{d.documentNumber ? ` ${d.documentNumber}` : ""} · {d.uploadedBy}, {fmtDateTime(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <CardTitle>How much we have and where</CardTitle>
          {v.stock.length === 0 ? (
            <EmptyState title="None left">All of this lot has been used, shipped or thrown away.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {v.stock.map((st) => (
                <li key={st.locationCode} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    {st.locationName} <span className="font-mono text-[12px] text-muted">{st.locationCode}</span>
                  </span>
                  <span className="font-medium tabular">{fmtLotQty(st.qty, lot.baseUom)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {lot.itemKind === "material" && (
          <Card>
            <CardTitle>Quality check (tests on arrival)</CardTitle>
            {v.inspections.length === 0 ? (
              <p className="text-[13px] text-muted">No quality check yet. Start one to take a sample and type the test results.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[14px]">
                {v.inspections.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <Link className="inline-flex min-h-[44px] items-center font-medium text-primary-text hover:underline" href={`/quality/inspections/${i.id}`}>
                      Open the quality check <span className="ml-1 font-mono text-[12px] font-normal text-muted">{i.number}</span>
                    </Link>
                    <InspectionStatusChip status={i.status} outcome={i.outcome} />
                  </li>
                ))}
              </ul>
            )}
            {v.can.startInspection && !v.inspections.some((i) => i.status !== "cancelled") && (
              <div className="mt-3">
                <StartInspectionButton lotId={lot.id} />
              </div>
            )}
          </Card>
        )}

        <Card>
          <CardTitle>Problem reports</CardTitle>
          {v.deviations.length === 0 ? (
            <p className="text-[13px] text-muted">No problem was reported for this lot. Something wrong? Use ⋯ More → Report a problem.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.deviations.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start gap-2 py-2 text-[14px]">
                  <Link className="min-w-0 flex-1 font-medium text-primary-text hover:underline" href={`/quality/deviations/${d.id}`}>
                    {d.description} <span className="font-mono text-[12px] font-normal text-muted">{d.number}</span>
                  </Link>
                  <DeviationStatusChip status={d.status} />
                  {d.status === "closed" && d.releasePermitted === false && <Chip tone="rej">May not be made OK</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <span id="decide" className="block scroll-mt-24" />
          <CardTitle>QA decision</CardTitle>
          {v.canDecide ? (
            <>
              {v.isReceiver && (
                <div className="mb-3">
                  <Banner tone="warn" title="You received this lot">
                    Another QA person must say OK to use. You may still stop it or say not OK.
                  </Banner>
                </div>
              )}
              <DecisionForm action={decideLotAction} hidden={{ lotId: lot.id }} options={options} />
            </>
          ) : (
            <div className="text-[13px] text-muted">
              Only a QA person can say OK or not OK.
              <WhoCanHelp permission="quality.disposition.approve" siteId={lot.siteId} hideEmails />
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Past QA decisions</CardTitle>
          {v.history.length === 0 ? (
            <EmptyState title="No decisions yet">Every OK or not OK on this lot is listed here with who gave it and why. Decisions are never changed afterwards.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.history.map((h) => (
                <li key={h.id} className="flex flex-col gap-1 py-2.5 text-[14px]">
                  <span className="flex flex-wrap items-center gap-2">
                    <DecisionChip decision={h.decision} />
                    <span className="text-[13px] text-fg-2">
                      {h.decidedByName}, {fmtDateTime(h.decidedAt)}
                    </span>
                  </span>
                  {h.reason && <span className="text-fg-2">“{h.reason}”</span>}
                  <span className="text-[12px]">
                    <Transition from={h.fromStatus} to={h.toStatus} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
