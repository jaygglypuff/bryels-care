import { fmtDate } from "@/lib/qty";
import type { MaterialUnitRow } from "@/modules/masterdata";
import { MoreDetails } from "@/ui/guide";
import { Badge, Panel } from "@/ui/kit";
import { ActionForm, Grid, SelectField, TextField } from "../../_org/form";
import { addMaterialUnitFormAction, changeMaterialUnitFormAction, retireMaterialUnitFormAction } from "../../_org/actions";

type Unit = MaterialUnitRow & { createdByName: string; recipeLines: number };

const num = (v: string) => Number(v).toLocaleString("en-PH", { maximumFractionDigits: 6 });

/**
 * ADR-137 "Packs and mL" on the material page: the named units a recipe line can count ("5 sachets"), add whole ("the
 * whole drum") or measure ("250 mL"). Each size is a version: "Change the size" keeps the old one on every recipe and
 * batch that used it. Read: masterdata.material.view; change: masterdata.material.edit (checked again by the service).
 */
export function UnitsPanel({ materialId, baseUom, units, canEdit }: { materialId: string; baseUom: string; units: Unit[]; canEdit: boolean }) {
  const active = units.filter((u) => u.status === "active");
  const old = units.filter((u) => u.status !== "active");
  const hasMl = active.some((u) => u.kind === "volume");
  return (
    <Panel title="Packs and mL" count={active.length} testId="material-units">
      <div className="space-y-3 p-4">
        <p className="text-[14px] text-fg-2">
          So a recipe can say &quot;add 5 sachets&quot;, &quot;add the whole drum&quot; or &quot;measure 250 mL&quot;. Stock is still counted in {baseUom}. Copy the numbers from the supplier&apos;s label or data sheet.
        </p>
        {active.length === 0 ? (
          <p className="rounded-[8px] border border-dashed border-line-strong p-4 text-center text-[14px] text-muted">No packs or mL yet. {canEdit ? "Add one below." : "Ask the person who sets up materials to add one."}</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th className="py-2 font-medium">Unit</th>
                <th className="py-2 text-right font-medium">One is</th>
                <th className="py-2 font-medium">Version</th>
                <th className="hidden py-2 font-medium sm:table-cell">Added by</th>
                <th className="py-2 text-right font-medium">Used in</th>
              </tr>
            </thead>
            <tbody>
              {active.map((u) => (
                <tr key={u.id} className="border-b border-line align-top" data-testid="unit-row">
                  <td className="py-2 font-medium">
                    {u.kind === "volume" ? "1 mL" : `1 ${u.name}`}
                    {u.note && <span className="block text-[12px] font-normal text-muted">{u.note}</span>}
                  </td>
                  <td className="py-2 text-right tabular">
                    {num(u.qtyPerUnit)} {u.baseUom}
                  </td>
                  <td className="py-2">v{u.versionNo}</td>
                  <td className="hidden py-2 sm:table-cell">
                    {u.createdByName} · {fmtDate(u.createdAt)}
                  </td>
                  <td className="py-2 text-right tabular">{u.recipeLines ? `${u.recipeLines} recipe line${u.recipeLines === 1 ? "" : "s"}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[8px] border border-line p-3">
              <h3 className="mb-2 text-[15px] font-semibold">Add a pack or mL</h3>
              <ActionForm action={addMaterialUnitFormAction} submitLabel="Add" hidden={{ _id: materialId }}>
                <Grid>
                  <SelectField
                    name="kind"
                    label="What is it?"
                    defaultValue="pack"
                    options={[
                      { value: "pack", label: "A pack you count (sachet, bottle, drum…)" },
                      ...(baseUom !== "pcs" && !hasMl ? [{ value: "volume", label: `mL (how many ${baseUom} in 1 mL)` }] : []),
                    ]}
                  />
                  <TextField name="name" label="Name of one pack" placeholder="sachet" hint="Leave empty for mL." />
                  <TextField name="qtyPerUnit" label={`One holds (${baseUom})`} placeholder="25" hint={baseUom === "g" ? "For mL: grams in 1 mL, for example 0.92." : undefined} />
                  <TextField name="note" label="Note (optional)" placeholder="From the supplier's label" />
                </Grid>
              </ActionForm>
            </div>
            {active.length > 0 && (
              <div className="rounded-[8px] border border-line p-3">
                <h3 className="mb-2 text-[15px] font-semibold">Change the size</h3>
                <p className="mb-2 text-[13px] text-muted">A new version is made. Recipes and batches made before keep the old size; a recipe uses the new one after its next version.</p>
                {active.map((u) => (
                  <MoreDetails key={u.id} title={`${u.kind === "volume" ? "1 mL" : `1 ${u.name}`} (now ${num(u.qtyPerUnit)} ${u.baseUom})`}>
                    <ActionForm action={changeMaterialUnitFormAction} submitLabel="Save the new size" hidden={{ _id: u.id }}>
                      <Grid>
                        <TextField name="qtyPerUnit" label={`New size (${u.baseUom})`} />
                        <TextField name="reason" label="Why?" placeholder="The supplier changed the bottle" />
                      </Grid>
                    </ActionForm>
                    <ActionForm action={retireMaterialUnitFormAction} submitLabel="Stop using it" variant="danger" hidden={{ _id: u.id }} className="mt-3">
                      <TextField name="reason" label="Why stop?" />
                    </ActionForm>
                  </MoreDetails>
                ))}
              </div>
            )}
          </div>
        )}
        {old.length > 0 && (
          <MoreDetails title={`Earlier sizes (${old.length})`}>
            <ul className="space-y-1 text-[13px]">
              {old.map((u) => (
                <li key={u.id}>
                  <Badge tone="neu">v{u.versionNo}</Badge> {u.kind === "volume" ? "1 mL" : `1 ${u.name}`} = {num(u.qtyPerUnit)} {u.baseUom} · stopped {u.retiredAt ? fmtDate(u.retiredAt) : ""}: {u.retiredReason}
                  {u.recipeLines ? ` · still on ${u.recipeLines} recipe line${u.recipeLines === 1 ? "" : "s"}` : ""}
                </li>
              ))}
            </ul>
          </MoreDetails>
        )}
      </div>
    </Panel>
  );
}
