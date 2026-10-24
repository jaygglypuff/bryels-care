import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listConversions, listMaterialMaster, listUoms } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ActionForm, CheckField, Grid, SelectField, TextField } from "../_org/form";
import { decideConversionAction, proposeConversionAction, saveUomAction } from "../_org/actions";
import { ActiveChip, AddCard, StateChip } from "../_org/ui";

/** Trims trailing zeros of a numeric(24,12) factor without touching integers. */
const fmtFactor = (f: string) => (f.includes(".") ? f.replace(/0+$/, "").replace(/\.$/, "") : f);

export const metadata = { title: "Units of measure" };

const DIMENSIONS = [
  { value: "mass", label: "Mass" },
  { value: "volume", label: "Volume" },
  { value: "count", label: "Count" },
  { value: "length", label: "Length" },
];

export default async function UomPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.uom.view")) return <Forbidden what="units of measure" />;
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
      <PageHeader title="Units of measure" subtitle="Stock is kept in one base unit per dimension (g, mL, pcs). Conversions say how much of one unit equals another; converting between mass and volume needs a material density. A conversion change is approved by a second administrator before it is used." />
      <Card>
        <CardTitle>Units</CardTitle>
        {units.length === 0 ? (
          <EmptyState title="No units installed">Run the reference-data installer (README) to add g, kg, mL, L and pcs.</EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {units.map((u) => (
              <li key={u.id} className="rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{u.code}</span>
                  <span className="flex gap-1">
                    {u.isBase && <StateChip status="approved" />}
                    <ActiveChip active={u.isActive} />
                  </span>
                </div>
                <p className="text-[13px]">{u.name} · {u.dimension}{u.isBase ? " · base unit" : ""}</p>
                {canUom && !u.isBase && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-primary-text">Edit</summary>
                    <div className="mt-2">
                      <ActionForm action={saveUomAction} submitLabel="Save" hidden={{ _id: u.id }}>
                        <TextField name="name" label="Name" defaultValue={u.name} />
                        <CheckField name="isActive" label="Active" defaultChecked={u.isActive} />
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
                <TextField name="code" label="Code" placeholder="drum" mono hint="Never changes once created." />
                <TextField name="name" label="Name" placeholder="Steel drum" />
                <SelectField name="dimension" label="Measures" defaultValue="count" options={DIMENSIONS} />
              </Grid>
              <CheckField name="isBase" label="Base unit of this dimension (only one per dimension)" defaultChecked={false} />
            </ActionForm>
          </div>
        )}
      </Card>
      {ctx.can("masterdata.uom_conversion.view") && (
        <Card>
          <CardTitle>Conversions in use</CardTitle>
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
        <AddCard title="Propose a conversion or a new factor">
          <ActionForm action={proposeConversionAction} submitLabel="Submit for approval" variant="cta">
            <Grid>
              <SelectField name="fromUomId" label="From (1 of this unit)" options={active.map((u) => ({ value: u.id, label: `${u.code} (${u.dimension})` }))} />
              <SelectField name="toUomId" label="Equals (this unit)" options={active.map((u) => ({ value: u.id, label: `${u.code} (${u.dimension})` }))} />
              <TextField name="factor" label="Factor" placeholder="1000" inputMode="decimal" mono hint="qty in 'equals' unit = qty in 'from' unit × factor." />
              <SelectField name="materialId" label="Material (needed for mass ↔ volume)" emptyLabel="— all materials —" options={mats.map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))} />
            </Grid>
            <TextField name="reason" label="Reason / source (e.g. supplier specification)" />
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
