import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { MATERIAL_CLASS_LABELS, MATERIAL_TRANSITIONS, getMaterial, lookupLabels, materialFormOptions, uomOptions, type MaterialClass, type MaterialStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { DeleteDraftCard } from "../../../delete-draft-button";
import { Forbidden } from "../../../forbidden";
import { ActionForm, TextField } from "../../_org/form";
import { materialStatusAction, saveMaterialAction } from "../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../_org/ui";
import { MaterialFields } from "../material-fields";

export const metadata = { title: "Material" };

const VERB: Record<MaterialStatus, string> = { draft: "Back to draft", active: "Activate", blocked: "Block", discontinued: "Discontinue" };

export default async function MaterialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.view")) return <Forbidden what="materials" />;
  const { id } = await params;
  const { created } = await searchParams;
  let m;
  try {
    m = await getMaterial(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Material not found" action={<LinkButton href="/masterdata/materials" variant="secondary">All materials</LinkButton>} />;
    throw e;
  }
  const canEdit = ctx.can("masterdata.material.edit") && m.status !== "discontinued";
  const baseUnits = await uomOptions(db, ctx.organizationId, { baseOnly: true });
  const options = await materialFormOptions(ctx, { keepCategory: m.category });
  const categoryLabel = m.category ? ((await lookupLabels(db, ctx.organizationId, "material_category")).get(m.category) ?? m.category) : null;
  const pack = m.standardPackQty ? `${Number(m.standardPackQty).toLocaleString("en-PH", { maximumFractionDigits: 6 })} ${m.standardPackUom}` : null;
  const moves = ctx.can("masterdata.material.edit") ? MATERIAL_TRANSITIONS[m.status as MaterialStatus] ?? [] : [];
  return (
    <div className="space-y-5">
      <PageHeader title={`${m.code} · ${m.name}`} subtitle={<>{MATERIAL_CLASS_LABELS[m.materialKind as MaterialClass] ?? m.materialKind} · base unit {m.baseUom}{categoryLabel ? ` · ${categoryLabel}` : ""}{m.brand ? ` · brand ${m.brand}` : ""}{pack ? ` · pack ${pack}` : ""} · <StateChip status={m.status} /></>} actions={<LinkButton href="/masterdata/materials" variant="secondary">All materials</LinkButton>} />
      {created === "1" && <Banner tone="ok" title="Material created">It can now be received and used in formulas.</Banner>}
      {m.warnings.map((w) => (
        <Banner key={w} tone="warn" title="Check before go-live">{w}</Banner>
      ))}
      <Card>
        <CardTitle>Material details</CardTitle>
        {canEdit ? (
          <ActionForm action={saveMaterialAction} submitLabel="Save material" hidden={{ _id: m.id }}>
            <MaterialFields baseUnits={baseUnits} options={options} d={m} locked={m.inUse} />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this material" />
        )}
      </Card>
      {moves.length > 0 && (
        <Card>
          <CardTitle>Status</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Blocking or discontinuing needs a reason. Discontinued is final; materials are never deleted.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((s) => (
              <ActionForm key={s} action={materialStatusAction} submitLabel={VERB[s]} variant={s === "active" ? "primary" : "danger"} hidden={{ _id: m.id, status: s }}>
                <TextField name="reason" label={s === "active" ? "Note (optional)" : "Reason"} />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
      {!m.inUse && (m.status === "draft" || m.status === "active") && (ctx.can("masterdata.material.edit") || ctx.can("masterdata.material.create")) && (
        <DeleteDraftCard kind="material" id={m.id} what="material" note="Nothing uses this material yet (no stock, formula, order or supplier link), so you can delete it, for example if it was added by mistake." />
      )}
    </div>
  );
}
