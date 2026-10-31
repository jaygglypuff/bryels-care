import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listConversions, listMaterialMaster, listUoms } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { ActionForm, CheckField, Grid, SelectField, TextField } from "../_org/form";
import { decideConversionAction, proposeConversionAction, saveUomAction } from "../_org/actions";
import { ActiveChip, AddCard, StateChip } from "../_org/ui";

/** Trims trailing zeros of a numeric(24,12) factor without touching integers. */
const fmtFactor = (f: string) => (f.includes(".") ? f.replace(/0+$/, "").replace(/\.$/, "") : f);

export const metadata = { title: "Units" };

const DIMENSIONS = [
  { value: "mass", label: "Weight" },
  { value: "volume", label: "Volume (liquids)" },
  { value: "count", label: "Pieces" },
  { value: "length", label: "Length" },
];
const DIM_WORD: Record<string, string> = Object.fromEntries(DIMENSIONS.map((d) => [d.value, d.label.toLowerCase()]));

export default async function UomPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.uom.view")) return <Forbidden what="units" />;
  const units = await listUoms(ctx, { includeInactive: true });
  const conv = ctx.can("masterdata.uom_conversion.view") ? await listConversions(ctx) : [];
  const canUom = ctx.can("masterdata.uom.admin");
  const canConv = ctx.can("masterdata.uom_conversion.admin");
  const mats = canConv && ctx.can("masterdata.material.view") ? await listMaterialMaster(ctx) : [];
  const pending = conv.filter((c) => c.status === "pending_approval");
  const current = conv.filter((c) => c.status === "approved");
  const history = conv.filter((c) => c.status === "retired" || c.status === "rejected");
  const active = units.filter((u) => u.isActive);
  return (
    <div className="space-y-5">
      <PageHeader title="Units" />
      <PageIntro>The units you count and buy in: grams, kilos, liters, pieces, or your own like &quot;sack&quot;. Stock is always counted in grams, milliliters or pieces; the system converts the rest.</PageIntro>
      <Card>
        <CardTitle>Units</CardTitle>
        {units.length === 0 ? (
          <EmptyState title="No units yet">Ask the system administrator to install the standard units (g, kg, mL, L and pieces).</EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {units.map((u) => (
              <li key={u.id} className="rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{u.name} <span className="font-mono text-[13px] text-muted">({u.code})</span></span>
                  <span className="flex gap-1">
                    {u.isBase && <StateChip status="approved" />}
                    <ActiveChip active={u.isActive} />
                  </span>
                </div>
                <p className="text-[13px] text-fg-2">{DIM_WORD[u.dimension] ?? u.dimension}{u.isBase ? " · stock is counted in this" : ""}</p>
                {canUom && !u.isBase && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-primary-text">Edit</summary>
                    <div className="mt-2">
                      <ActionForm action={saveUomAction} submitLabel="Save" hidden={{ _id: u.id }}>
                        <TextField name="name" label="Name" defaultValue={u.name} />
                        <CheckField name="isActive" label="In use" defaultChecked={u.isActive} />
                      </ActionForm>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {canUom && (
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={saveUomAction} submitLabel="Add unit">
              <Grid>
                <TextField name="name" label="Name of the unit" placeholder="e.g. Sack" />
                <SelectField name="dimension" label="What does it measure?" defaultValue="count" options={DIMENSIONS} />
              </Grid>
              <MoreDetails>
                <TextField name="code" label="Short name shown next to amounts (optional)" placeholder="Made from the name, e.g. sack" mono hint="Never changes once created." />
                <CheckField name="isBase" label="Stock is counted in this unit (only one per kind; normally g, mL and pcs)" defaultChecked={false} />
              </MoreDetails>
              <p className="text-[13px] text-muted">To say how much one sack holds, add a conversion below.</p>
            </ActionForm>
          </div>
        )}
      </Card>
      {ctx.can("masterdata.uom_conversion.view") && (
        <Card>
          <CardTitle>Conversions in use</CardTitle>
          <p className="mb-2 text-[13px] text-muted">A new conversion is checked by a second administrator before it is used.</p>
          {current.length === 0 ? (
            <p className="text-[13px] text-muted">No approved conversions.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {current.map((c) => (
                <li key={c.id} className="rounded-[12px] border border-line p-3">
                  <p className="font-mono text-[14px]">
                    1 {c.fromCode} = {fmtFactor(c.factor)} {c.toCode}
                  </p>
                  <p className="text-[12px] text-muted">
                    {c.materialCode ? `${c.materialCode} · ${c.materialName}` : "All materials"} · v{c.revisionNo} ·{" "}
                    {c.isSystem ? "system reference" : `approved by ${c.approvedBy ?? "—"}${c.approvedAt ? ` on ${fmtDate(c.approvedAt.toISOString())}` : ""}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {pending.length > 0 && (
        <Card>
          <CardTitle>Waiting for a second approval ({pending.length})</CardTitle>
          <ul className="space-y-3">
            {pending.map((c) => (
              <li key={c.id} className="rounded-[14px] border border-line p-3">
                <p className="text-[14px]">
                  <span className="font-mono">1 {c.fromCode} = {fmtFactor(c.factor)} {c.toCode}</span> · {c.materialCode ? `${c.materialCode} only` : "all materials"} · v{c.revisionNo}
                </p>
                <p className="text-[12px] text-muted">Proposed by {c.submittedBy ?? "—"}{c.changeReason ? `: ${c.changeReason}` : ""}</p>
                {canConv && c.submittedById !== ctx.userId ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={decideConversionAction} submitLabel="Approve" hidden={{ _id: c.id, decision: "approved" }}>
                      <TextField name="note" label="Note (optional)" />
                    </ActionForm>
                    <ActionForm action={decideConversionAction} submitLabel="Reject" variant="danger" hidden={{ _id: c.id, decision: "rejected" }}>
                      <TextField name="note" label="Reason" />
                    </ActionForm>
                  </div>
                ) : (
                  canConv && <p className="mt-2 text-[12px] text-muted">You proposed this change; another administrator decides it.</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canConv && (
        <AddCard title="Say how much one unit holds (conversion)">
          <ActionForm action={proposeConversionAction} submitLabel="Submit for approval" variant="cta">
            <Grid>
              <SelectField name="fromUomId" label="1 of this unit…" options={active.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))} />
              <SelectField name="toUomId" label="…holds this unit" options={active.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))} />
              <TextField name="factor" label="How many" placeholder="1000" inputMode="decimal" mono hint="1 of the first unit = this many of the second." />
              <SelectField name="materialId" label="Only for this material (needed for weight ↔ volume)" emptyLabel="All materials" options={mats.map((m) => ({ value: m.id, label: m.name }))} />
            </Grid>
            <TextField name="reason" label="Where does the number come from? (e.g. supplier's sheet)" />
          </ActionForm>
        </AddCard>
      )}
      {history.length > 0 && (
        <Card>
          <CardTitle>History</CardTitle>
          <ul className="space-y-1 text-[13px]">
            {history.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">1 {c.fromCode} = {fmtFactor(c.factor)} {c.toCode}</span>
                <span className="text-muted">{c.materialCode ?? "all materials"} · v{c.revisionNo}</span>
                <StateChip status={c.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
