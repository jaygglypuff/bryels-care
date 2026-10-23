import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getTemplate, type TemplateDetail } from "@/modules/documents";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DefinitionEditor, TestPageButton, VersionOp, VersionReasonOp } from "../forms";

export const metadata = { title: "Layout" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "ok" | "warn" | "neu" | "bad"> = { approved: "ok", draft: "neu", pending_approval: "warn", retired: "bad" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("documents.template.view")) return <Forbidden what="templates" />;
  const { id } = await params;
  let t: TemplateDetail;
  try {
    t = await getTemplate(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const open = t.versions.find((v) => v.status === "draft" || v.status === "pending_approval");
  const effective = t.versions.find((v) => v.status === "approved");
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title={t.code}
        subtitle={`${t.name} · ${t.templateKind.replace(/_/g, " ")} · renderer ${t.renderers.map((r) => `${r.id} v${r.version}`).join(", ") || "none"}`}
        actions={
          <>
            <LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>
            {!open && ctx.can("documents.template.edit") && <VersionOp templateId={t.id} op="new_draft" label="New version" variant="cta" />}
          </>
        }
      />
      {!effective && <Banner tone="warn" title="No effective version">Nothing prints with this layout until QA approves a version.</Banner>}

      {t.versions.map((v) => (
        <Card key={v.id}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <CardTitle>Version {v.versionNo}</CardTitle>
            <Chip tone={TONE[v.status] ?? "neu"}>{v.status.replace("_", " ")}</Chip>
            <span className="font-mono text-[12px] text-muted">checksum {v.definitionChecksum.slice(0, 8)}</span>
          </div>
          <p className="text-[13px] text-fg-2">
            Created by {v.authorName}, {fmtDateTime(v.createdAt)}
            {v.submittedByName ? ` · submitted by ${v.submittedByName}, ${fmtDateTime(v.submittedAt)}` : ""}
            {v.approvedByName ? ` · approved by ${v.approvedByName}, ${fmtDateTime(v.approvedAt)}` : ""}
            {v.retiredAt ? ` · retired ${fmtDateTime(v.retiredAt)}${v.retireReason ? ` (${v.retireReason})` : ""}` : ""}
          </p>
          {v.changeNote && <p className="mt-1 text-[13px] text-muted">{v.changeNote}</p>}

          {v.status === "draft" && ctx.can("documents.template.edit") ? (
            <div className="mt-4"><DefinitionEditor templateId={t.id} versionId={v.id} definition={JSON.stringify(v.definition, null, 2)} /></div>
          ) : (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-muted">Definition</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-[12px] bg-surface-2 p-3 text-[12px]">{JSON.stringify(v.definition, null, 2)}</pre>
            </details>
          )}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
            {v.status === "draft" && ctx.can("documents.template.submit") && <VersionOp templateId={t.id} versionId={v.id} op="submit" label="Submit for approval" variant="cta" />}
            {v.status === "pending_approval" && ctx.can("documents.template.approve") && (
              v.submittedBy === ctx.userId ? (
                <p className="text-[13px] text-muted">You submitted this version, so someone else must approve it.</p>
              ) : (
                <VersionOp templateId={t.id} versionId={v.id} op="approve" label="Approve" variant="cta" confirm={`Approve ${t.code} v${v.versionNo}? It becomes the effective version${effective ? ` and v${effective.versionNo} is retired` : ""}.`} />
              )
            )}
            {t.templateKind === "test_page" && v.status !== "retired" && ctx.can("documents.generated_document.create") && <TestPageButton versionId={v.id} />}
          </div>
          {v.status === "pending_approval" && ctx.can("documents.template.approve") && v.submittedBy !== ctx.userId && (
            <div className="mt-3"><VersionReasonOp templateId={t.id} versionId={v.id} op="return" label="Send back" /></div>
          )}
          {v.status !== "retired" && ctx.can("documents.template.void") && (
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer text-muted">Retire this version</summary>
              <div className="mt-2"><VersionReasonOp templateId={t.id} versionId={v.id} op="retire" label="Retire" /></div>
            </details>
          )}
        </Card>
      ))}
    </div>
  );
}
