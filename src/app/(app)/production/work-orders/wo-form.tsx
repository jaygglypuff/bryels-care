"use client";
import { useActionState, useMemo, useState } from "react";
import { D, fmtQty } from "@/lib/qty";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { createWorkOrderAction, editWorkOrderAction } from "./actions";

type Options = {
  formulas: { formulaId: string; formulaCode: string; formulaName: string; productId: string; productName: string; productSku: string; unitNetMassG: string; referenceBatchSizeG: string | null; theoreticalYieldPct: string | null; effectiveRevision: string | null }[];
  lines: { id: string; code: string; name: string }[];
  supervisors: { id: string; displayName: string }[];
  today: string;
};
type Initial = {
  workOrderId: string;
  productId: string;
  formulaId: string;
  batchSizeKg: string;
  batchCount: number;
  plannedStart: string;
  plannedEnd: string;
  productionLineId: string | null;
  priority: number;
  assignedSupervisorId: string | null;
  targetUnits: string | null;
  notes: string | null;
};

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const plusDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Work order form (W05-02). The server validates everything again; the preview is guidance only. */
export function WorkOrderForm({ mode, options, initial }: { mode: "create" | "edit"; options: Options; initial?: Initial }) {
  const [state, action] = useActionState(mode === "create" ? createWorkOrderAction : editWorkOrderAction, null);
  const [key] = useState(newKey);
  const products = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const f of options.formulas) m.set(f.productId, { id: f.productId, label: `${f.productName} (${f.productSku})` });
    return [...m.values()];
  }, [options.formulas]);
  const [productId, setProductId] = useState(initial?.productId ?? products[0]?.id ?? "");
  const fs = options.formulas.filter((f) => f.productId === productId);
  const [formulaId, setFormulaId] = useState(initial?.formulaId ?? fs[0]?.formulaId ?? "");
  const f = fs.find((x) => x.formulaId === formulaId) ?? fs[0];
  const [sizeKg, setSizeKg] = useState(initial?.batchSizeKg ?? (f?.referenceBatchSizeG ? D(f.referenceBatchSizeG).div(1000).toString() : ""));
  const [count, setCount] = useState(String(initial?.batchCount ?? 1));
  const [start, setStart] = useState(initial?.plannedStart ?? plusDays(options.today, 1));
  const fe = state?.fieldErrors ?? {};

  let preview: string | null = null;
  try {
    if (f && sizeKg && D(sizeKg).gt(0) && Number(count) > 0) {
      const totalKg = D(sizeKg).mul(count);
      const units = f.theoreticalYieldPct ? D(sizeKg).mul(1000).mul(f.theoreticalYieldPct).div(100).div(f.unitNetMassG).floor().mul(count) : null;
      preview = `${fmtQty(totalKg, "kg", 2)} in ${count} batch${count === "1" ? "" : "es"}${units ? ` · about ${fmtQty(units, "units", 0)} at theoretical yield` : ""}`;
    }
  } catch {
    preview = null;
  }

  return (
    <Card>
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="idempotencyKey" value={key} />
        {initial && <input type="hidden" name="workOrderId" value={initial.workOrderId} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product" htmlFor="productId" error={fe.productId}>
            <Select
              id="productId"
              name="productId"
              value={productId}
              disabled={mode === "edit"}
              onChange={(e) => {
                setProductId(e.target.value);
                const first = options.formulas.find((x) => x.productId === e.target.value);
                setFormulaId(first?.formulaId ?? "");
                if (first?.referenceBatchSizeG) setSizeKg(D(first.referenceBatchSizeG).div(1000).toString());
              }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
            {mode === "edit" && <input type="hidden" name="productId" value={productId} />}
          </Field>
          <Field label="Formula" htmlFor="formulaId" error={fe.formulaId} hint={f?.effectiveRevision ? `Approved ${f.effectiveRevision}; revisions are resolved again when the production order is planned.` : "No approved revision yet: planning will be refused (V-REV)."}>
            <Select id="formulaId" name="formulaId" value={f?.formulaId ?? ""} onChange={(e) => setFormulaId(e.target.value)}>
              {fs.map((x) => (
                <option key={x.formulaId} value={x.formulaId}>{x.formulaCode} · {x.formulaName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Batch size (kg)" htmlFor="batchSizeKg" error={fe.batchSizeKg} hint={f?.referenceBatchSizeG ? `Reference size ${fmtQty(D(f.referenceBatchSizeG).div(1000), "kg", 1)}` : undefined}>
            <Input id="batchSizeKg" name="batchSizeKg" inputMode="decimal" value={sizeKg} onChange={(e) => setSizeKg(e.target.value)} />
          </Field>
          <Field label="Number of batches" htmlFor="batchCount" error={fe.batchCount}>
            <Input id="batchCount" name="batchCount" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required />
          </Field>
          <Field label="Planned start" htmlFor="plannedStart" error={fe.plannedStart}>
            <Input id="plannedStart" name="plannedStart" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Planned end" htmlFor="plannedEnd" error={fe.plannedEnd}>
            <Input id="plannedEnd" name="plannedEnd" type="date" defaultValue={initial?.plannedEnd ?? plusDays(options.today, 2)} required />
          </Field>
          <Field label="Production line" htmlFor="productionLineId" error={fe.productionLineId}>
            <Select id="productionLineId" name="productionLineId" defaultValue={initial?.productionLineId ?? ""}>
              <option value="">Not assigned</option>
              {options.lines.map((l) => (
                <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Supervisor" htmlFor="assignedSupervisorId" error={fe.assignedSupervisorId}>
            <Select id="assignedSupervisorId" name="assignedSupervisorId" defaultValue={initial?.assignedSupervisorId ?? ""}>
              <option value="">Not assigned</option>
              {options.supervisors.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority (1 = highest)" htmlFor="priority" error={fe.priority}>
            <Select id="priority" name="priority" defaultValue={String(initial?.priority ?? 5)}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Field label="Target units (optional)" htmlFor="targetUnits" error={fe.targetUnits}>
            <Input id="targetUnits" name="targetUnits" inputMode="numeric" defaultValue={initial?.targetUnits ?? ""} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="notes" error={fe.notes}>
          <Textarea id="notes" name="notes" defaultValue={initial?.notes ?? ""} maxLength={1000} />
        </Field>
        {preview && <p className="rounded-[12px] border border-line bg-surface-2/60 px-3.5 py-2.5 text-[13px]">{preview}</p>}
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Saving…">
          {mode === "create" ? "Create production order" : "Save changes"}
        </SubmitButton>
      </form>
    </Card>
  );
}
