import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getTemplate, type TemplateDetail } from "@/modules/documents";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../forbidden";
import { DefinitionEditor, TestPageButton, VersionOp, VersionReasonOp } from "../forms";

export const metadata = { title: "Layout" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "ok" | "warn" | "neu" | "bad"> = { approved: "ok", draft: "neu", pending_approval: "warn", retired: "bad" };
const STATUS_TEXT: Record<string, string> = { approved: "OK for printing", draft: "Draft – QA must OK it", pending_approval: "Waits for QA's OK", retired: "Not used any more" };


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
        title={t.name}
        subtitle={<>{t.templateKind.replace(/_/g, " ")} · <RecordNo>{t.code}</RecordNo></>}
        actions={
          <>
            <LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>
            {!open && ctx.can("documents.template.edit") && <VersionOp templateId={t.id} op="new_draft" label="Start a new version" variant="cta" />}
          </>
        }
      />
      <PageIntro>This screen is for QA and the IT person: the versions of one printed page layout. Only the version QA said OK to is used for printing; a new version starts as a draft.</PageIntro>
      {open && open.status === "pending_approval" && ctx.can("documents.template.approve") && open.submittedBy !== ctx.userId && <NextStep text={`Version ${open.versionNo} waits for your OK.`} action={{ label: "Look at it", href: `#v-${open.id}` }} />}
      {open && open.status === "draft" && ctx.can("documents.template.submit") && <NextStep text={`Version ${open.versionNo} is a draft. When it is ready, send it to QA.`} action={{ label: "Open the draft", href: `#v-${open.id}` }} />}
      {!effective && <Banner tone="warn" title="No version is OK'd yet">Nothing prints with this layout until QA says OK to a version.</Banner>}

      {t.versions.map((v) => (
        <Card key={v.id} id={`v-${v.id}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <CardTitle>Version {v.versionNo}</CardTitle>
            <Chip tone={TONE[v.status] ?? "neu"}>{STATUS_TEXT[v.status] ?? v.status.replace("_", " ")}</Chip>
          </div>
          <p className="text-[13px] text-fg-2">
            Made by {v.authorName}, {fmtDateTime(v.createdAt)}
            {v.submittedByName ? ` · sent to QA by ${v.submittedByName}, ${fmtDateTime(v.submittedAt)}` : ""}
            {v.approvedByName ? ` · OK'd by ${v.approvedByName}, ${fmtDateTime(v.approvedAt)}` : ""}
            {v.retiredAt ? ` · stopped ${fmtDateTime(v.retiredAt)}${v.retireReason ? ` (${v.retireReason})` : ""}` : ""}
          </p>
          {v.changeNote && <p className="mt-1 text-[13px] text-muted">{v.changeNote}</p>}

          {v.status === "draft" && ctx.can("documents.template.edit") ? (
            <div className="mt-4">
              <MoreDetails title="Change the settings (technical, for the IT person)">
                <DefinitionEditor templateId={t.id} versionId={v.id} definition={JSON.stringify(v.definition, null, 2)} />
              </MoreDetails>
            </div>
          ) : (
            <details className="mt-3">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] text-muted">Settings (technical)</summary>
              <p className="font-mono text-[12px] text-muted">check number {v.definitionChecksum.slice(0, 8)}</p>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-surface-2 p-3 text-[12px]">{JSON.stringify(v.definition, null, 2)}</pre>
            </details>
          )}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
            {v.status === "draft" && ctx.can("documents.template.submit") && <VersionOp templateId={t.id} versionId={v.id} op="submit" label="Send to QA for OK" variant="cta" />}
            {v.status === "pending_approval" && ctx.can("documents.template.approve") && (
              v.submittedBy === ctx.userId ? (
                <p className="text-[13px] text-muted">You sent this version, so someone else must say OK.</p>
              ) : (
                <VersionOp templateId={t.id} versionId={v.id} op="approve" label="OK for printing" variant="cta" confirm={`Say OK to version ${v.versionNo}? It will be used from now on${effective ? ` and version ${effective.versionNo} stops` : ""}.`} />
              )
            )}
            {t.templateKind === "test_page" && v.status !== "retired" && ctx.can("documents.generated_document.create") && <TestPageButton versionId={v.id} />}
          </div>
          {v.status === "pending_approval" && ctx.can("documents.template.approve") && v.submittedBy !== ctx.userId && (
            <div className="mt-3"><VersionReasonOp templateId={t.id} versionId={v.id} op="return" label="Send back" /></div>
          )}
          {v.status !== "retired" && ctx.can("documents.template.void") && (
            <details className="mt-3 text-[13px]">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-muted">⋯ Stop using this version</summary>
              <div className="mt-2"><VersionReasonOp templateId={t.id} versionId={v.id} op="retire" label="Stop using it" /></div>
            </details>
          )}
        </Card>
      ))}
    </div>
  );
}
