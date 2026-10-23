import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listLabelTemplates, listStations, listTemplates, recentDocuments } from "@/modules/documents";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Templates & labels" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "warn" | "neu" | "bad"> = { approved: "ok", draft: "neu", pending_approval: "warn", retired: "bad" };

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
        title="Templates & labels"
        subtitle="Versioned document layouts, label templates and print stations. Layouts are configuration of built-in renderers; QA approves every version."
        actions={
          <>
            {ctx.can("documents.template.create") && <LinkButton href="/admin/templates/new" variant="cta">New layout</LinkButton>}
            {ctx.can("masterdata.label_template.create") && <LinkButton href="/admin/templates/labels/new" variant="secondary">New label template</LinkButton>}
            {ctx.can("documents.print_station.admin") && <LinkButton href="/admin/templates/stations" variant="secondary">Print stations</LinkButton>}
          </>
        }
      />

      {canLabels && (
        <Card>
          <CardTitle>Label templates</CardTitle>
          {labels.length === 0 ? (
            <EmptyState title="No label templates yet.">Create one, then ask QA to approve it before labels can print.</EmptyState>
          ) : (
            <Table head={["Code", "Applies to", "Media", "Symbology", "Layout", "Status"]}>
              {labels.map((l) => (
                <tr key={l.id}>
                  <Td><Link href={`/admin/templates/labels/${l.id}`} className="font-mono text-primary-text hover:underline">{l.code}</Link><div className="text-[12px] text-muted">{l.name}</div></Td>
                  <Td>{l.appliesTo.replace("_", " ")}</Td>
                  <Td>{Number(l.mediaWidthMm)} × {Number(l.mediaHeightMm)} mm · {l.dpi} dpi</Td>
                  <Td>{l.symbology === "qr" ? "QR" : "Code 128"}</Td>
                  <Td className="font-mono">{l.layoutCode}</Td>
                  <Td><Chip tone={STATUS_TONE[l.status] ?? "neu"}>{l.status}</Chip></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {canDocs && (
        <Card>
          <CardTitle>Document layouts</CardTitle>
          {templates.length === 0 ? (
            <EmptyState title="No document layouts yet." />
          ) : (
            <Table head={["Code", "Kind", "Page", "Effective version", "Latest", "Waiting approval"]}>
              {templates.map((t) => (
                <tr key={t.id}>
                  <Td><Link href={`/admin/templates/${t.id}`} className="font-mono text-primary-text hover:underline">{t.code}</Link><div className="text-[12px] text-muted">{t.name}</div></Td>
                  <Td>{t.templateKind.replace(/_/g, " ")}</Td>
                  <Td>{t.pageSize === "label" ? "label media" : `${t.pageSize} ${t.orientation}`}</Td>
                  <Td>{t.approvedVersionNo ? <Chip tone="ok">v{t.approvedVersionNo}</Chip> : <Chip tone="warn">none</Chip>}</Td>
                  <Td>v{t.latestVersionNo}</Td>
                  <Td>{t.pendingCount ? <Chip tone="warn">{t.pendingCount}</Chip> : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {stations.length > 0 && (
        <Card>
          <CardTitle>Print stations</CardTitle>
          <ul className="divide-y divide-line text-[13px]">
            {stations.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-mono">{s.siteCode} · {s.code}</span> · {s.name}</span>
                <span className="text-muted">{s.printerName}</span>
                <Chip tone={s.isActive ? "ok" : "neu"}>{s.isActive ? "Active" : "Inactive"}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {docs.length > 0 && (
        <Card>
          <CardTitle>Recently generated documents</CardTitle>
          <ul className="divide-y divide-line text-[13px]">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/documents/${d.id}`} className="font-mono text-primary-text hover:underline">{d.documentNumber}</Link>
                <span className="text-muted">{d.documentKind.replace(/_/g, " ")} · {d.templateCode} v{d.versionNo} · {d.generatedByName}, {fmtDateTime(d.generatedAt)}</span>
                <Chip tone={d.status === "ready" ? "ok" : d.status === "void" ? "bad" : "warn"}>{d.watermark ?? d.status}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
