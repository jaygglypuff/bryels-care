"use client";
import { useState, type ReactNode } from "react";
import { Box, Droplet, FlaskConical, Hash, PencilRuler, Scale } from "lucide-react";
import { ADD_METHODS, ADD_METHOD_WORDS, type AddMethod, ROUNDING_WORDS, type RoundingRule, unitWord } from "@/modules/masterdata/add-methods";
import { type RecipeLineDraft, type UnitSizes, lineGrams, linePerUnit, methodOf } from "@/modules/masterdata/recipe-blocks";
import { Button, Input, Select, cx } from "@/ui/core";
import { Badge } from "@/ui/kit";
import { addMaterialUnitAction, saveRecipeTemplateAction } from "./actions";
import { safeCall } from "./wizard-keep";

/**
 * ADR-137 "How is it added?" on one ingredient line of the recipe wizard: the method picker and the fields of each way
 * (count, measure in mL, whole container, add until it is right, my own way). Pure UI: the numbers are worked out with
 * the same helpers the server uses (recipe-blocks / add-methods), and the server checks everything again.
 */

export type UnitOption = { id: string; materialId: string; kind: string; name: string; qtyPerUnit: string; baseUom: string };
export type MethodTemplate = { id: string; name: string; body: unknown };

const ICON: Record<AddMethod, ReactNode> = {
  weigh: <Scale size={20} aria-hidden />,
  count: <Hash size={20} aria-hidden />,
  volume: <Droplet size={20} aria-hidden />,
  whole_container: <Box size={20} aria-hidden />,
  as_needed: <FlaskConical size={20} aria-hidden />,
  custom: <PencilRuler size={20} aria-hidden />,
};

const n = (v: string, dp = 6) => (v && !Number.isNaN(Number(v)) ? Number(v).toLocaleString("en-PH", { maximumFractionDigits: dp }) : "");

function Err({ text }: { text?: string }) {
  return text ? (
    <p role="alert" className="text-[13px] font-medium text-[var(--bad-fg)]">
      {text}
    </p>
  ) : null;
}

function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[14px] font-semibold text-fg">
        {children}
      </label>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

/** What changes when the method changes (never a number the writer typed for another way). */
function switchTo(m: AddMethod, l: RecipeLineDraft, packs: UnitOption[], volume: UnitOption | undefined, defaultDiff: string): Partial<RecipeLineDraft> {
  switch (m) {
    case "count":
      return { method: m, methodQty: "", unitId: packs[0]?.id ?? null, diffKind: "units", diff: "0", scaling: "proportional_round", rounding: "up" };
    case "whole_container":
      return { method: m, methodQty: "1", unitId: packs[0]?.id ?? null, diffKind: "units", diff: "0", scaling: "fixed", rounding: "" };
    case "volume":
      return { method: m, methodQty: "", unitId: volume?.id ?? null, diffKind: "pct", diff: defaultDiff, scaling: "proportional", rounding: "" };
    case "as_needed":
      return { method: m, recordBy: "weigh", amount: l.method === "weigh" || !l.method ? l.amount : "", src: "g", maxAmount: "", readingName: l.readingName || "pH", readingUnit: "", readingMin: "", readingMax: "", scaling: "proportional", rounding: "", unitId: null };
    case "custom":
      return { method: m, customName: l.customName ?? "", customUnit: l.customUnit ?? "", customUnitQty: "", methodQty: "", diffKind: "pct", diff: defaultDiff, scaling: "proportional", rounding: "", unitId: null };
    default:
      return { method: "weigh", diffKind: "pct", diff: l.diff || defaultDiff, scaling: "proportional", rounding: "", unitId: null, methodQty: "" };
  }
}

export function HowAdded(p: {
  l: RecipeLineDraft;
  i: number;
  setLine: (i: number, patch: Partial<RecipeLineDraft>) => void;
  err: (k: string) => string | undefined;
  batchG: string;
  baseUom: string;
  materialName: string;
  units: UnitOption[];
  sizes: UnitSizes;
  canEditMaterial: boolean;
  canSaveTemplate: boolean;
  onUnitAdded: (u: UnitOption) => void;
  templates: MethodTemplate[];
  defaultDiff: string;
  /** The grams / percent fields of a weighed line (the wizard's own, unchanged). */
  weighFields: ReactNode;
}) {
  const { l, i, setLine, err } = p;
  const m = methodOf(l);
  const mine = p.units.filter((u) => u.materialId === l.materialId);
  const packs = mine.filter((u) => u.kind === "pack");
  const volume = mine.find((u) => u.kind === "volume");
  const set = (patch: Partial<RecipeLineDraft>) => setLine(i, patch);
  const per = linePerUnit(l, p.sizes);
  const grams = lineGrams(p.batchG, l, p.sizes);
  const unitName = m === "volume" || (m === "as_needed" && l.recordBy === "volume") ? "mL" : m === "custom" ? l.customUnit || "unit" : (mine.find((u) => u.id === l.unitId)?.name ?? "unit");
  const id = (k: string) => `${k}-${i}`;

  return (
    <div className="flex flex-col gap-3" data-testid={`how-added-${i + 1}`}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[14px] font-semibold">How is it added?</legend>
        <div role="radiogroup" aria-label="How is it added?" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ADD_METHODS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={m === k}
              data-testid={`method-${k}`}
              onClick={() => m !== k && set(switchTo(k, l, packs, volume, p.defaultDiff))}
              className={cx("flex min-h-[48px] items-center gap-2 rounded-[6px] border px-3 text-left text-[14px]", m === k ? "border-ring bg-primary-soft font-semibold text-fg" : "border-line bg-surface text-fg-2 hover:bg-surface-2")}
            >
              {ICON[k]}
              <span>{ADD_METHOD_WORDS[k].label}</span>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">{ADD_METHOD_WORDS[m].help}</p>
      </fieldset>

      {m === "weigh" && p.weighFields}

      {(m === "count" || m === "whole_container") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={id("mq")}>{m === "count" ? "How many?" : "How many containers?"}</FieldLabel>
            <div className="flex items-center gap-2">
              <Input id={id("mq")} inputMode="numeric" className="w-28 text-[18px] font-semibold" value={l.methodQty ?? ""} onChange={(e) => set({ methodQty: e.target.value.replace(/[^\d]/g, "") })} />
              <Select aria-label={m === "count" ? "What you count" : "Which container"} className="min-w-36" value={l.unitId ?? ""} onChange={(e) => set({ unitId: e.target.value || null })} data-testid={`unit-${i + 1}`}>
                <option value="">{packs.length ? "Choose…" : "No packs yet"}</option>
                {packs.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({n(u.qtyPerUnit)} {u.baseUom})
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-[13px] tabular text-muted">{per && l.methodQty ? `= ${n(grams)} ${p.baseUom} (1 ${unitName} = ${n(per)} ${p.baseUom})` : ""}</p>
            <Err text={err("methodQty") ?? err("materialUnitId")} />
            {m === "whole_container" && <p className="text-[13px] text-fg-2">The whole container goes in. Nothing is weighed. If it was opened before, what is left in it is used.</p>}
          </div>
          {m === "count" && <UnitsDiff {...p} unitName={unitName} whole />}
        </div>
      )}

      {m === "volume" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={id("ml")}>How many mL?</FieldLabel>
            <div className="flex items-center gap-2">
              <Input id={id("ml")} inputMode="decimal" className="w-32 text-[18px] font-semibold" value={l.methodQty ?? ""} onChange={(e) => set({ methodQty: e.target.value.replace(",", ".") })} />
              <span className="text-[17px] font-medium">mL</span>
            </div>
            <p className="text-[13px] tabular text-muted">{volume ? `1 mL = ${n(volume.qtyPerUnit)} ${p.baseUom}${l.methodQty && per ? ` · = ${n(grams)} ${p.baseUom}` : ""}` : ""}</p>
            <Err text={err("methodQty") ?? err("materialUnitId")} />
          </div>
          <UnitsDiff {...p} unitName="mL" />
        </div>
      )}

      {(m === "count" || m === "whole_container" || m === "volume" || (m === "as_needed" && l.recordBy && l.recordBy !== "weigh")) && (
        <AddUnit
          {...p}
          kind={m === "volume" || l.recordBy === "volume" ? "volume" : "pack"}
          has={m === "volume" || l.recordBy === "volume" ? !!volume : packs.length > 0}
          onAdded={(u) => {
            p.onUnitAdded(u);
            set({ unitId: u.id });
          }}
        />
      )}

      {m === "as_needed" && <AsNeeded {...p} packs={packs} volume={volume} unitName={unitName} />}

      {m === "custom" && <CustomWay {...p} unitName={unitName} grams={grams} />}

      {m !== "weigh" && <Scaling l={l} i={i} set={set} unitName={unitName} canRound={m === "count" || m === "whole_container" || m === "volume" || (m === "custom" && !!per)} err={err} />}

      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={id("note")} hint="Shown to the person adding it, on the screen and on paper.">
          Tip for the person adding it (optional)
        </FieldLabel>
        <Input id={id("note")} maxLength={300} value={l.note ?? ""} placeholder="For example: shake the bottle first" onChange={(e) => set({ note: e.target.value })} />
      </div>
    </div>
  );
}

/** "Allowed difference": ± units (0 = exactly) or ± %. */
function UnitsDiff(p: { l: RecipeLineDraft; i: number; setLine: (i: number, patch: Partial<RecipeLineDraft>) => void; err: (k: string) => string | undefined; unitName: string; whole?: boolean }) {
  const { l, i } = p;
  const kind = l.diffKind === "units" ? "units" : "pct";
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={`udiff-${i}`} hint={kind === "units" && (l.diff.trim() === "0" || l.diff.trim() === "") ? "0 means exactly." : undefined}>
        Allowed difference
      </FieldLabel>
      <div className="flex items-center gap-2">
        <span className="text-[17px]">±</span>
        <Input id={`udiff-${i}`} inputMode="decimal" className="w-24" value={l.diff} onChange={(e) => p.setLine(i, { diff: e.target.value.replace(",", ".") })} />
        <Select aria-label="Allowed difference in" className="w-32" value={kind} onChange={(e) => p.setLine(i, { diffKind: e.target.value as "units" | "pct" })}>
          <option value="units">{unitWord(p.unitName, 2)}</option>
          <option value="pct">%</option>
        </Select>
      </div>
      <Err text={p.err("tolerancePct") ?? p.err("toleranceUnits")} />
    </div>
  );
}

/** "Add a pack size" / "Add the grams in 1 mL" without leaving the wizard (masterdata.material.edit). */
function AddUnit(p: { l: RecipeLineDraft; i: number; baseUom: string; materialName: string; canEditMaterial: boolean; kind: "pack" | "volume"; has: boolean; onAdded: (u: UnitOption) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState(p.baseUom === "mL" && p.kind === "volume" ? "1" : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!p.l.materialId) return null;
  if (!p.canEditMaterial) return p.has ? null : <p className="text-[13px] text-fg-2">{p.materialName} has no {p.kind === "volume" ? "mL" : "packs"} yet. Ask someone who keeps materials to add {p.kind === "volume" ? "how many grams are in 1 mL" : "a pack size"} on its page.</p>;
  if (!open)
    return (
      <button type="button" className="self-start text-[13px] text-primary-text underline" onClick={() => setOpen(true)} data-testid={`add-unit-${p.i + 1}`}>
        {p.kind === "volume" ? (p.has ? "" : `Add how many ${p.baseUom} are in 1 mL of ${p.materialName}`) : `Add a pack size of ${p.materialName} (sachet, bottle, drum…)`}
      </button>
    );
  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await safeCall(() => addMaterialUnitAction({ materialId: p.l.materialId, kind: p.kind, name: p.kind === "volume" ? "mL" : name, qtyPerUnit: qty }));
    setBusy(false);
    if (!r?.ok || !r.data) return setMsg(r?.message ?? "Not saved.");
    p.onAdded({ id: r.data.unitId, materialId: p.l.materialId, kind: p.kind, name: r.data.name, qtyPerUnit: r.data.qtyPerUnit, baseUom: r.data.baseUom });
    setOpen(false);
  };
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface-2 p-3" data-testid={`add-unit-form-${p.i + 1}`}>
      <p className="text-[13px] text-fg-2">Copy the number from the supplier&apos;s label or data sheet. It is saved on {p.materialName} and kept with every recipe that uses it.</p>
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        {p.kind === "pack" ? (
          <>
            <span>1</span>
            <Input aria-label="Pack name" className="w-32" placeholder="sachet" value={name} onChange={(e) => setName(e.target.value)} />
            <span>holds</span>
          </>
        ) : (
          <span>1 mL weighs</span>
        )}
        <Input aria-label={p.kind === "pack" ? "How much one pack holds" : "Grams in 1 mL"} inputMode="decimal" className="w-28" value={qty} onChange={(e) => setQty(e.target.value.replace(",", "."))} />
        <span>{p.baseUom}</span>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {msg && <Err text={msg} />}
    </div>
  );
}

function AsNeeded(p: Parameters<typeof HowAdded>[0] & { packs: UnitOption[]; volume: UnitOption | undefined; unitName: string }) {
  const { l, i, setLine, err } = p;
  const set = (patch: Partial<RecipeLineDraft>) => setLine(i, patch);
  const by = l.recordBy ?? "weigh";
  const inUnits = by !== "weigh";
  const unitShown = by === "weigh" ? p.baseUom : by === "volume" ? "mL" : unitWord(p.unitName, 2);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`rn-${i}`} hint="What tells you it is enough, for example pH or thickness.">
            Add until
          </FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input id={`rn-${i}`} className="w-28" value={l.readingName ?? ""} placeholder="pH" onChange={(e) => set({ readingName: e.target.value })} />
            <span>is</span>
            <Input aria-label="Lowest" inputMode="decimal" className="w-20" value={l.readingMin ?? ""} onChange={(e) => set({ readingMin: e.target.value.replace(",", ".") })} />
            <span>to</span>
            <Input aria-label="Highest" inputMode="decimal" className="w-20" value={l.readingMax ?? ""} onChange={(e) => set({ readingMax: e.target.value.replace(",", ".") })} />
            <Input aria-label="Reading unit (optional)" className="w-20" value={l.readingUnit ?? ""} placeholder="unit" onChange={(e) => set({ readingUnit: e.target.value })} />
          </div>
          <Err text={err("methodSpec.reading")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`rb-${i}`}>Write down what was used by</FieldLabel>
          <Select
            id={`rb-${i}`}
            value={by}
            onChange={(e) => {
              const v = e.target.value as "weigh" | "count" | "volume";
              set({ recordBy: v, unitId: v === "volume" ? (p.volume?.id ?? null) : v === "count" ? (p.packs[0]?.id ?? null) : null, methodQty: "", amount: "", maxAmount: "" });
            }}
          >
            <option value="weigh">Weighing it</option>
            <option value="count">Counting it</option>
            <option value="volume">Measuring it in mL</option>
          </Select>
          {by === "count" && (
            <Select aria-label="What you count" value={l.unitId ?? ""} onChange={(e) => set({ unitId: e.target.value || null })}>
              <option value="">{p.packs.length ? "Choose…" : "No packs yet"}</option>
              {p.packs.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({n(u.qtyPerUnit)} {u.baseUom})
                </option>
              ))}
            </Select>
          )}
          <Err text={err("materialUnitId")} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`an-${i}`} hint="Your best guess, used to plan and set aside stock.">
            About how much?
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id={`an-${i}`}
              inputMode="decimal"
              className="w-32 text-[18px] font-semibold"
              value={inUnits ? (l.methodQty ?? "") : l.amount}
              onChange={(e) => (inUnits ? set({ methodQty: e.target.value.replace(",", ".") }) : set({ amount: e.target.value.replace(",", "."), src: "g" }))}
            />
            <span className="text-[16px]">{unitShown}</span>
          </div>
          <Err text={err("quantityG") ?? err("methodQty")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`am-${i}`} hint="More than this needs QA to say yes.">
            At most
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Input id={`am-${i}`} inputMode="decimal" className="w-32" value={l.maxAmount ?? ""} onChange={(e) => set({ maxAmount: e.target.value.replace(",", ".") })} />
            <span className="text-[16px]">{unitShown}</span>
          </div>
          <Err text={err("maxQtyG")} />
        </div>
      </div>
      <p className="text-[12px] text-muted">Not part of the 100%: it is added a little at a time on the floor.</p>
    </div>
  );
}

function CustomWay(p: Parameters<typeof HowAdded>[0] & { unitName: string; grams: string }) {
  const { l, i, setLine, err } = p;
  const set = (patch: Partial<RecipeLineDraft>) => setLine(i, patch);
  const measured = (l.customUnitQty ?? "").trim() !== "";
  const [notMeasured, setNotMeasured] = useState(!measured && !!l.customName);
  const [msg, setMsg] = useState<string | null>(null);
  const saveTemplate = async () => {
    setMsg(null);
    const r = await safeCall(() =>
      saveRecipeTemplateAction({
        kind: "add_method",
        name: (l.customName ?? "").trim(),
        body: { method: "custom", customName: l.customName ?? "", customUnit: l.customUnit ?? "", customUnitQty: l.customUnitQty ?? "", diffKind: l.diffKind, diff: l.diff, needsCheck: l.needsCheck, note: l.note ?? "" },
      }),
    );
    setMsg(r?.message ?? "Not saved.");
  };
  return (
    <div className="flex flex-col gap-3">
      {p.templates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`tpl-${i}`}>Use a way saved before</FieldLabel>
          <Select
            id={`tpl-${i}`}
            value=""
            data-testid={`method-template-${i + 1}`}
            onChange={(e) => {
              const t = p.templates.find((x) => x.id === e.target.value);
              const b = (t?.body ?? {}) as Partial<RecipeLineDraft> & { customName?: string };
              if (t) set({ customName: b.customName ?? "", customUnit: b.customUnit ?? "", customUnitQty: b.customUnitQty ?? "", diffKind: (b.diffKind as RecipeLineDraft["diffKind"]) ?? "pct", diff: b.diff ?? "", note: b.note ?? "" });
              setNotMeasured(!(b.customUnitQty ?? "").trim());
            }}
          >
            <option value="">Choose a saved way…</option>
            {p.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`cn-${i}`}>Name of your way</FieldLabel>
          <Input id={`cn-${i}`} maxLength={80} value={l.customName ?? ""} placeholder="Scoop with measuring spoon #3" onChange={(e) => set({ customName: e.target.value })} />
          <Err text={err("methodSpec.customName")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`cu-${i}`}>What do you call one?</FieldLabel>
          <Input id={`cu-${i}`} maxLength={30} value={l.customUnit ?? ""} placeholder="scoop" onChange={(e) => set({ customUnit: e.target.value })} />
          <Err text={err("methodUnit")} />
        </div>
      </div>
      <label className="flex min-h-[44px] items-start gap-3 text-[14px]">
        <input
          type="checkbox"
          className="mt-0.5 h-6 w-6 shrink-0"
          checked={notMeasured}
          onChange={(e) => {
            setNotMeasured(e.target.checked);
            set(e.target.checked ? { customUnitQty: "", methodQty: "", diffKind: "pct", scaling: l.scaling === "proportional_round" ? "proportional" : l.scaling, rounding: "" } : { diffKind: "units", diff: "0" });
          }}
        />
        <span>
          <b>Not measured: write down what was used</b>
          <span className="block text-[12px] text-muted">The person adding it writes the amount used in {p.baseUom}.</span>
        </span>
      </label>
      {notMeasured ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`ca-${i}`} hint="Your best guess, used to plan and set aside stock.">
              About how much?
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Input id={`ca-${i}`} inputMode="decimal" className="w-32 text-[18px] font-semibold" value={l.amount} onChange={(e) => set({ amount: e.target.value.replace(",", "."), src: "g" })} />
              <span className="text-[16px]">{p.baseUom}</span>
            </div>
            <Err text={err("quantityG")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`cd-${i}`}>Allowed difference</FieldLabel>
            <div className="flex items-center gap-2">
              <span className="text-[17px]">±</span>
              <Input id={`cd-${i}`} inputMode="decimal" className="w-24" value={l.diff} onChange={(e) => set({ diff: e.target.value.replace(",", ".") })} />
              <Select aria-label="Allowed difference in" className="w-24" value={l.diffKind === "g" ? "g" : "pct"} onChange={(e) => set({ diffKind: e.target.value as "pct" | "g" })}>
                <option value="pct">%</option>
                <option value="g">{p.baseUom}</option>
              </Select>
            </div>
            <Err text={err("tolerancePct")} />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`cq-${i}`}>How many?</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Input id={`cq-${i}`} inputMode="decimal" className="w-24 text-[18px] font-semibold" value={l.methodQty ?? ""} onChange={(e) => set({ methodQty: e.target.value.replace(",", ".") })} />
              <span>{unitWord(p.unitName, 2)}, one is about</span>
              <Input aria-label={`How much one ${p.unitName} is`} inputMode="decimal" className="w-24" value={l.customUnitQty ?? ""} onChange={(e) => set({ customUnitQty: e.target.value.replace(",", ".") })} />
              <span>{p.baseUom}</span>
            </div>
            <p className="text-[13px] tabular text-muted">{l.methodQty && l.customUnitQty ? `= ${n(p.grams)} ${p.baseUom}` : ""}</p>
            <Err text={err("methodQty") ?? err("methodUnitQty")} />
          </div>
          <UnitsDiff {...p} unitName={p.unitName} />
        </div>
      )}
      {p.canSaveTemplate && (l.customName ?? "").trim() && (l.customUnit ?? "").trim() && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={saveTemplate} data-testid={`save-method-template-${i + 1}`}>
            Save this way for later recipes
          </Button>
          {msg && <span className="text-[13px] text-fg-2">{msg}</span>}
        </div>
      )}
    </div>
  );
}

/** "When the batch is bigger or smaller" (never rounded silently: the rule is chosen here and printed on the batch). */
function Scaling({ l, i, set, unitName, canRound, err }: { l: RecipeLineDraft; i: number; set: (p: Partial<RecipeLineDraft>) => void; unitName: string; canRound: boolean; err: (k: string) => string | undefined }) {
  const whole = l.method === "count" || l.method === "whole_container";
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={`sc-${i}`}>When the batch is bigger or smaller</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id={`sc-${i}`}
          className="min-w-56"
          value={l.scaling}
          onChange={(e) => {
            const v = e.target.value as RecipeLineDraft["scaling"];
            set({ scaling: v, rounding: v === "proportional_round" ? (l.rounding || "up") : "" });
          }}
          data-testid={`scaling-${i + 1}`}
        >
          {!whole && <option value="proportional">Grow with the batch</option>}
          <option value="fixed">Same for every batch</option>
          {canRound && <option value="proportional_round">Grow with the batch, whole {unitWord(unitName, 2)} only</option>}
        </Select>
        {l.scaling === "proportional_round" && (
          <Select aria-label="How to round" value={l.rounding || "up"} onChange={(e) => set({ rounding: e.target.value as RoundingRule })} data-testid={`rounding-${i + 1}`}>
            {(["up", "down", "nearest"] as const).map((r) => (
              <option key={r} value={r}>
                {ROUNDING_WORDS[r].replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </Select>
        )}
        {l.scaling === "proportional_round" && <Badge tone="info">Shown on every batch</Badge>}
      </div>
      <Err text={err("scaling") ?? err("rounding")} />
    </div>
  );
}
