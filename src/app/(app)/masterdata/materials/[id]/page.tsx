import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { MATERIAL_KIND_DEFAULTS, MATERIAL_TRANSITIONS, getMaterial, lookupLabels, materialFormOptions, type MaterialStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { DeleteDraftCard } from "../../../delete-draft-button";
import { Forbidden } from "../../../forbidden";
import { ActionForm, TextField } from "../../_org/form";
import { materialStatusAction, saveMaterialAction } from "../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../_org/ui";
import { MaterialFields } from "../material-fields";
import { KIND_WORDS, countWords } from "../words";

export const metadata = { title: "Material" };

const VERB: Record<MaterialStatus, string> = { draft: "Back to draft", active: "Ready to use", blocked: "Stop using it for now", discontinued: "No longer used" };

export default async function MaterialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.view")) return <Forbidden what="materials" />;
  const { id } = await params;
  const { created } = await searchParams;
  let m;
  try {
    m = await getMaterial(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Material not found" action={<LinkButton href="/masterdata/materials" variant="secondary">All materials</LinkButton>}>It may have been deleted. Go back to the list and search by name.</EmptyState>;
    throw e;
  }
  const canEdit = ctx.can("masterdata.material.edit") && m.status !== "discontinued";
  const options = await materialFormOptions(ctx, { keepCategory: m.category });
  const categoryLabel = m.category ? ((await lookupLabels(db, ctx.organizationId, "material_category")).get(m.category) ?? m.category) : null;
  const pack = m.standardPackQty ? `${Number(m.standardPackQty).toLocaleString("en-PH", { maximumFractionDigits: 6 })} ${m.standardPackUom}` : null;
  const moves = ctx.can("masterdata.material.edit") ? MATERIAL_TRANSITIONS[m.status as MaterialStatus] ?? [] : [];
  const canSeeStock = ctx.can("inventory.lot.view");
  return (
    <div className="space-y-5">
      <PageHeader
        title={m.name}
        subtitle={
          <>
            <span className="font-mono text-[12px] text-muted">{m.code}</span> · {KIND_WORDS[m.materialKind] ?? m.materialKind} · {countWords(m.baseUom)}
            {categoryLabel ? ` · ${categoryLabel}` : ""}
            {m.brand ? ` · brand ${m.brand}` : ""}
            {pack ? ` · one pack holds ${pack}` : ""} · <StateChip status={m.status} />
          </>
        }
        actions={
          <>
            {canSeeStock && <LinkButton href={`/inventory/items/material/${m.id}`} variant="cta">See stock</LinkButton>}
            <LinkButton href="/masterdata/materials" variant="secondary">All materials</LinkButton>
          </>
        }
      />
      <PageIntro>Everything the system knows about this material. Change a box and press Save.</PageIntro>
      {created === "1" && <Banner tone="ok" title={`${m.name} added as ${m.code}`}>You can now order it, receive it and use it in recipes.</Banner>}
      {m.warnings.map((w) => (
        <Banner key={w} tone="warn" title="Please check">{w}</Banner>
      ))}
      <Card>
        <CardTitle>Details</CardTitle>
        {canEdit ? (
          <ActionForm action={saveMaterialAction} submitLabel="Save" hidden={{ _id: m.id }}>
            <MaterialFields options={{ ...options, kindDefaults: MATERIAL_KIND_DEFAULTS }} d={m} locked={m.inUse} />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this material" />
        )}
      </Card>
      {moves.length > 0 && (
        <MoreDetails title="Stop using it, or use it again">
          <p className="text-[13px] text-muted">Stopping needs a reason. &quot;No longer used&quot; is final; materials that were used are never deleted.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((s) => (
              <ActionForm key={s} action={materialStatusAction} submitLabel={VERB[s]} variant={s === "active" ? "primary" : "danger"} hidden={{ _id: m.id, status: s }}>
                <TextField name="reason" label={s === "active" ? "Note (optional)" : "Why?"} />
              </ActionForm>
            ))}
          </div>
        </MoreDetails>
      )}
      {!m.inUse && (m.status === "draft" || m.status === "active") && (ctx.can("masterdata.material.edit") || ctx.can("masterdata.material.create")) && (
        <DeleteDraftCard kind="material" id={m.id} what="material" note="Nothing uses this material yet (no stock, recipe, order or supplier link), so you can delete it, for example if it was added by mistake." />
      )}
    </div>
  );
}
