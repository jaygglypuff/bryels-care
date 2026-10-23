import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { DEFAULT_LABEL_FIELDS, getLabelTemplate, LABEL_DATASET_FOR, LABEL_FIELD_KEYS, labelLayoutTemplates } from "@/modules/documents";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { LabelStatusOp, LabelTemplateForm } from "../../forms";

export const metadata = { title: "Label template" };
export const dynamic = "force-dynamic";

export default async function LabelTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.label_template.view")) return <Forbidden what="label templates" />;
  const { id } = await params;
  let t: Awaited<ReturnType<typeof getLabelTemplate>>;
  try {
    t = await getLabelTemplate(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const canEdit = ctx.can("masterdata.label_template.edit") && t.status !== "retired";
  const layouts = canEdit ? await labelLayoutTemplates(ctx) : [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={t.code}
        subtitle={t.name}
        actions={
          <>
            <LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>
            <LinkButton href={`/print/labels/test/${t.id}`} target="_blank" variant="secondary">Test page</LinkButton>
          </>
        }
      />
      {t.status === "draft" && <Banner tone="warn" title="Draft: not printable">QA must approve this label template (someone other than {t.editorName}, who made the last change).</Banner>}
      {!t.layoutVersion && <Banner tone="warn" title="Layout has no approved version">Layout {t.layoutCode} needs an approved version before labels can print.</Banner>}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <CardTitle>Configuration</CardTitle>
          <Chip tone={t.status === "approved" ? "ok" : t.status === "draft" ? "warn" : "neu"}>{t.status}</Chip>
        </div>
        <Dl
          items={[
            ["Applies to", t.appliesTo.replace("_", " ")],
            ["Media", `${Number(t.mediaWidthMm)} × ${Number(t.mediaHeightMm)} mm · ${t.dpi} dpi`],
            ["Symbology", t.symbology === "qr" ? "QR Code" : "Code 128"],
            ["Layout", `${t.layoutCode}${t.layoutVersion ? ` v${t.layoutVersion.versionNo}` : " (no approved version)"}`],
            ["Fields", t.fieldKeys.map((k) => k.replace(/_/g, " ")).join(", ") || "—"],
            ["Last change", `${t.editorName}, ${fmtDateTime(t.updatedAt)}`],
            ["Approved", t.approvedAt ? `${t.approverName}, ${fmtDateTime(t.approvedAt)}` : "—"],
          ]}
        />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          {t.status === "draft" && ctx.can("masterdata.label_template.approve") && (t.updatedBy === ctx.userId ? <p className="text-[13px] text-muted">You made the last change, so someone else must approve.</p> : <LabelStatusOp id={t.id} op="approve" />)}
        </div>
      </Card>
      {canEdit && (
        <Card>
          <CardTitle>Edit</CardTitle>
          <LabelTemplateForm
            layouts={layouts}
            appliesTo={Object.keys(LABEL_DATASET_FOR)}
            fieldKeys={LABEL_FIELD_KEYS}
            defaults={DEFAULT_LABEL_FIELDS}
            values={{ id: t.id, code: t.code, name: t.name, documentTemplateId: t.documentTemplateId, appliesTo: t.appliesTo, symbology: t.symbology, copiesDefault: t.copiesDefault, mediaWidthMm: String(Number(t.mediaWidthMm)), mediaHeightMm: String(Number(t.mediaHeightMm)), dpi: t.dpi, fields: t.fieldKeys }}
          />
        </Card>
      )}
      {t.status !== "retired" && ctx.can("masterdata.label_template.approve") && (
        <Card>
          <details>
            <summary className="cursor-pointer text-[14px] font-semibold">Retire this template</summary>
            <div className="mt-3"><LabelStatusOp id={t.id} op="retire" /></div>
          </details>
        </Card>
      )}
    </div>
  );
}
