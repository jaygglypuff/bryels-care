import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { DEFAULT_LABEL_FIELDS, getLabelTemplate, LABEL_DATASET_FOR, LABEL_FIELD_KEYS, labelLayoutTemplates } from "@/modules/documents";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../../forbidden";
import { LabelStatusOp, LabelTemplateForm } from "../../forms";
import { APPLIES_TEXT } from "../../words";

export const metadata = { title: "Label" };
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
        title={t.name}
        subtitle={<RecordNo>{t.code}</RecordNo>}
        actions={
          <>
            <LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>
            <LinkButton href={`/print/labels/test/${t.id}`} target="_blank" variant="secondary">Print a test label</LinkButton>
          </>
        }
      />
      <PageIntro>This screen is for QA and the IT person: one label – what it is for, its size and what is printed on it. It prints only after QA said OK.</PageIntro>
      {t.status === "draft" && ctx.can("masterdata.label_template.approve") && t.updatedBy !== ctx.userId && <NextStep text="This label waits for your OK. Print a test label first and check it." action={{ label: "Decide", href: "#decide" }} />}
      {t.status === "draft" && !(ctx.can("masterdata.label_template.approve") && t.updatedBy !== ctx.userId) && <NextStep text="This label cannot print yet." waitingFor={`QA must say OK (someone other than ${t.editorName}, who made the last change).`} />}
      {!t.layoutVersion && <Banner tone="warn" title="Its page layout has no OK'd version">The layout needs a version QA said OK to before labels can print.</Banner>}
      <Card id="decide">
        <div className="mb-3 flex items-center gap-2">
          <CardTitle>About this label</CardTitle>
          <Chip tone={t.status === "approved" ? "ok" : t.status === "draft" ? "warn" : "neu"}>{t.status === "approved" ? "OK for printing" : t.status === "draft" ? "Draft – QA must OK it" : "Not used any more"}</Chip>
        </div>
        <Dl
          items={[
            ["For", APPLIES_TEXT[t.appliesTo] ?? t.appliesTo.replace(/_/g, " ")],
            ["Size", `${Number(t.mediaWidthMm)} × ${Number(t.mediaHeightMm)} mm`],
            ["What is printed", t.fieldKeys.map((k) => k.replace(/_/g, " ")).join(", ") || "—"],
            ["Last change", `${t.editorName}, ${fmtDateTime(t.updatedAt)}`],
            ["OK'd by", t.approvedAt ? `${t.approverName}, ${fmtDateTime(t.approvedAt)}` : "—"],
          ]}
        />
        <div className="mt-3">
          <MoreDetails title="Printer details">
            <Dl
              items={[
                ["Barcode", t.symbology === "qr" ? "QR code" : "Code 128"],
                ["Printer sharpness", `${t.dpi} dpi`],
                ["Page layout", `${t.layoutCode}${t.layoutVersion ? ` version ${t.layoutVersion.versionNo}` : " (no OK'd version)"}`],
              ]}
            />
          </MoreDetails>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          {t.status === "draft" && ctx.can("masterdata.label_template.approve") && (t.updatedBy === ctx.userId ? <p className="text-[13px] text-muted">You made the last change, so someone else must say OK.</p> : <LabelStatusOp id={t.id} op="approve" />)}
        </div>
      </Card>
      {canEdit && (
        <Card>
          <CardTitle>Change this label</CardTitle>
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
            <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-semibold">⋯ Stop using this label</summary>
            <div className="mt-3"><LabelStatusOp id={t.id} op="retire" /></div>
          </details>
        </Card>
      )}
    </div>
  );
}
