import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listLabelTemplates, listStations, listTemplates, recentDocuments } from "@/modules/documents";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { APPLIES_TEXT } from "./words";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Labels and printouts" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "warn" | "neu" | "bad"> = { approved: "ok", draft: "neu", pending_approval: "warn", retired: "bad" };
const STATUS_TEXT: Record<string, string> = { approved: "OK for printing", draft: "Draft – QA must OK it", pending_approval: "Waits for QA's OK", retired: "Not used any more" };


export default async function TemplatesPage() {
  const ctx = await requireContext();
  const canDocs = ctx.can("documents.template.view");
  const canLabels = ctx.can("masterdata.label_template.view");
  if (!canDocs && !canLabels) return <Forbidden what="templates" />;
  const [templates, labels, stations, docs] = await Promise.all([
    canDocs ? listTemplates(ctx) : Promise.resolve([]),
    canLabels ? listLabelTemplates(ctx) : Promise.resolve([]),
    ctx.can("inventory.label_job.view") || ctx.can("documents.print_station.admin") ? listStations(ctx, { includeInactive: true }) : Promise.resolve([]),
    ctx.can("documents.generated_document.view") ? recentDocuments(ctx, 20) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Labels and printouts"
        actions={
          <>
            {ctx.can("masterdata.label_template.create") && <LinkButton href="/admin/templates/labels/new" variant="cta">New label</LinkButton>}
            {(ctx.can("documents.template.create") || ctx.can("documents.print_station.admin")) && (
              <MoreMenu>
                <div className="flex flex-col gap-2">
                  {ctx.can("documents.template.create") && <LinkButton href="/admin/templates/new" variant="secondary" size="sm">New page layout</LinkButton>}
                  {ctx.can("documents.print_station.admin") && <LinkButton href="/admin/templates/stations" variant="secondary" size="sm">Label printers (where they are)</LinkButton>}
                </div>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for QA and the IT person: how labels and printed pages look, and which label printers there are. A label prints only after QA said OK to it.</PageIntro>

      {canLabels && (
        <section aria-labelledby="labels-h">
          <h2 id="labels-h" className="mb-2 font-display text-[18px] font-semibold">Labels</h2>
          {labels.length === 0 ? (
            <Card>
              <EmptyState title="No labels yet">Press “New label”, then ask QA to OK it before it can print.</EmptyState>
            </Card>
          ) : (
            <PlainList label="Labels">
              {labels.map((l) => (
                <PlainRow
                  key={l.id}
                  href={`/admin/templates/labels/${l.id}`}
                  title={l.name}
                  code={l.code}
                  status={<Chip tone={STATUS_TONE[l.status] ?? "neu"}>{STATUS_TEXT[l.status] ?? l.status}</Chip>}
                  facts={`${APPLIES_TEXT[l.appliesTo] ?? l.appliesTo.replace(/_/g, " ")} · ${Number(l.mediaWidthMm)} × ${Number(l.mediaHeightMm)} mm · ${l.symbology === "qr" ? "QR code" : "bar code"}`}
                />
              ))}
            </PlainList>
          )}
        </section>
      )}

      {canDocs && (
        <section aria-labelledby="layouts-h">
          <h2 id="layouts-h" className="mb-2 font-display text-[18px] font-semibold">Page layouts</h2>
          {templates.length === 0 ? (
            <Card>
              <EmptyState title="No page layouts yet">Layouts come with the app; QA says OK to each version.</EmptyState>
            </Card>
          ) : (
            <PlainList label="Page layouts">
              {templates.map((t) => (
                <PlainRow
                  key={t.id}
                  href={`/admin/templates/${t.id}`}
                  title={t.name}
                  code={t.code}
                  status={
                    <>
                      {t.approvedVersionNo ? <Chip tone="ok">In use: version {t.approvedVersionNo}</Chip> : <Chip tone="warn">No version OK&apos;d yet</Chip>}
                      {t.pendingCount > 0 && <Chip tone="warn">{t.pendingCount} waits for QA</Chip>}
                    </>
                  }
                  facts={`${t.templateKind.replace(/_/g, " ")} · ${t.pageSize === "label" ? "label paper" : `${t.pageSize} ${t.orientation}`}`}
                />
              ))}
            </PlainList>
          )}
        </section>
      )}

      {stations.length > 0 && (
        <MoreDetails title={`Label printers (${stations.length})`}>
          <ul className="divide-y divide-line text-[14px]">
            {stations.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {s.name} <span className="text-muted">· {s.siteCode} · {s.printerName}</span>
                </span>
                <Chip tone={s.isActive ? "ok" : "neu"}>{s.isActive ? "In use" : "Not used"}</Chip>
              </li>
            ))}
          </ul>
        </MoreDetails>
      )}

      {docs.length > 0 && (
        <MoreDetails title="Recently printed pages">
          <ul className="divide-y divide-line text-[13px]">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/documents/${d.id}`} className="inline-flex min-h-[40px] items-center font-mono text-primary-text hover:underline">{d.documentNumber}</Link>
                <span className="text-muted">{d.documentKind.replace(/_/g, " ")} · {d.generatedByName}, {fmtDateTime(d.generatedAt)}</span>
                <Chip tone={d.status === "ready" ? "ok" : d.status === "void" ? "bad" : "warn"}>{d.watermark ?? (d.status === "ready" ? "Ready" : d.status)}</Chip>
              </li>
            ))}
          </ul>
        </MoreDetails>
      )}
    </div>
  );
}
