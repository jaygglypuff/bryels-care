import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { MATERIAL_KIND_DEFAULTS, MATERIAL_TRANSITIONS, getMaterial, lookupLabels, materialFormOptions, type MaterialStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { NextStepBox } from "@/ui/next-step-box";
import { waitingFor } from "../../../waiting-for";
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
  if (!ctx.can("masterdata.material.view")) return <Forbidden what="materials" permission="masterdata.material.view" />;
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
      <RecordHeader
        back={{ href: "/masterdata/materials", label: "Materials" }}
        typeLabel={KIND_WORDS[m.materialKind] ?? m.materialKind}
        title={m.name}
        chip={<StateChip status={m.status} />}
        meta={[<span key="code" className="font-mono">{m.code}</span>, countWords(m.baseUom), categoryLabel, m.brand ? `brand ${m.brand}` : null, pack ? `one pack holds ${pack}` : null]}
      />
      <PageIntro>Everything the system knows about this material. Change a box and press Save.</PageIntro>
      {created === "1" && <Banner tone="ok" title={`${m.name} added as ${m.code}`}>You can now order it, receive it and use it in recipes.</Banner>}
      {m.status === "draft" && moves.includes("active") ? (
        <NextStepBox text="Next: when the details are right, mark it ready to use. Then it can be ordered, received and used in recipes.">
          <ActionForm action={materialStatusAction} submitLabel="Ready to use" variant="cta" hidden={{ _id: m.id, status: "active" }}>
            <TextField name="reason" label="Note (optional)" />
          </ActionForm>
        </NextStepBox>
      ) : m.status === "draft" ? (
        <NextStep text="This material is not ready to use yet." waitingFor={await waitingFor(ctx, "masterdata.material.edit", null, "to mark it ready to use", "the person who sets up materials")} />
      ) : m.status === "active" && canSeeStock ? (
        <NextStep text="Ready to use. See how much we have and where." action={{ label: "See stock", href: `/inventory/items/material/${m.id}` }} />
      ) : m.status === "active" ? (
        <NextStep text="Ready to use. Nothing to do here." />
      ) : (
        <NextStep text={m.status === "blocked" ? "Stopped for now: it cannot be received or used." : "No longer used. Kept on record."} />
      )}
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
            {moves.filter((s) => !(m.status === "draft" && s === "active")).map((s) => (
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
