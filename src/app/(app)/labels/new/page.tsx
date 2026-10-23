import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { labelRequestOptions } from "@/modules/documents";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { JobStatus, STATUS_AT_PRINT } from "../bits";
import { CreateJobForm } from "../forms";

export const metadata = { title: "Print label" };

export default async function NewLabelPage({ searchParams }: { searchParams: Promise<{ entityType?: string; entityId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.create")) return <Forbidden what="label printing" />;
  const { entityType = "", entityId = "" } = await searchParams;
  if (!["inventory_lot", "location"].includes(entityType)) notFound();
  let o: Awaited<ReturnType<typeof labelRequestOptions>>;
  try {
    o = await labelRequestOptions(ctx, entityType, entityId);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  const back = entityType === "inventory_lot" ? `/inventory/${o.entity.id}` : `/inventory?loc=${o.entity.id}`;
  const live = o.history.filter((j) => j.status === "printed" && !j.voidedAt);
  const sameState = live.find((j) => j.statusAtPrint === o.entity.state);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={`Label · ${o.entity.number}`}
        subtitle={`${o.entity.caption}${o.entity.name ? ` · ${o.entity.name}` : ""} · ${o.entity.siteCode}${o.entity.state && STATUS_AT_PRINT[o.entity.state] ? ` · status now ${STATUS_AT_PRINT[o.entity.state]}` : ""}`}
        actions={<LinkButton href={back} variant="secondary">Back</LinkButton>}
      />
      {!o.isCurrentSite ? (
        <Banner tone="info" title={`This record is at ${o.entity.siteCode}`}>Switch site to print its label there.</Banner>
      ) : o.stations.length === 0 ? (
        <Banner tone="info" title={`Label printing isn't set up for ${o.entity.siteCode} yet`}>Ask an administrator to add a print station for this site.</Banner>
      ) : o.templates.length === 0 ? (
        <Banner tone="info" title="No approved label template">QA must approve a {o.entity.appliesTo.replace("_", " ")} label template before labels can print.</Banner>
      ) : sameState ? (
        <Banner tone="warn" title="A label with this content was already printed" action={<LinkButton href={`/labels/jobs/${sameState.reprintOfId ?? sameState.id}`} variant="secondary" size="sm">Reprint with a reason</LinkButton>}>
          Printed {fmtDateTime(sameState.printedAt)} by {sameState.printedByName}. A second copy is a reprint: it needs a reason and is logged.
        </Banner>
      ) : (
        <Card>
          <CardTitle>Request a label</CardTitle>
          {live.length > 0 && (
            <p className="mb-3 text-[13px] text-[var(--warn-fg)]">The status changed since the last label. Printing a new one marks the old {live.length === 1 ? "label" : "labels"} as superseded; destroy them.</p>
          )}
          <CreateJobForm entityType={o.entity.type} entityId={o.entity.id} templates={o.templates} stations={o.stations} />
        </Card>
      )}

      <Card>
        <CardTitle>Label history</CardTitle>
        {o.history.length === 0 ? (
          <p className="text-[13px] text-muted">No labels printed for this record yet.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {o.history.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/labels/jobs/${j.id}`} className="text-primary-text hover:underline">
                  {j.templateCode} · {j.copies}×{j.reprintNo ? ` · REPRINT ${j.reprintNo}` : ""}
                </Link>
                <span className="text-muted">{fmtDateTime(j.requestedAt)} · {j.statusAtPrint ? STATUS_AT_PRINT[j.statusAtPrint] ?? j.statusAtPrint : ""}</span>
                <JobStatus status={j.status} voided={!!j.voidedAt} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
