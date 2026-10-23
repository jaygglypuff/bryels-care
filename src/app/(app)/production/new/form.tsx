"use client";
import { useActionState, useMemo, useState } from "react";
import { D, fmtQty } from "@/lib/qty";
import { Card, Dl, Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { createBatchAction } from "../actions";

type Option = {
  revisionId: string;
  revisionNo: number;
  referenceBatchSizeG: string;
  theoreticalYieldPct: string;
  formulaCode: string;
  formulaName: string;
  productId: string;
  productName: string;
  productSku: string;
  lineCount: number;
  stepCount: number;
  effectiveFrom?: string | null;
  routingLabel?: string | null;
};

export function NewBatchForm({ options, today, idempotencyKey }: { options: Option[]; today: string; idempotencyKey: string }) {
  const [state, action] = useActionState(createBatchAction, null);
  const products = useMemo(() => {
    const m = new Map<string, { id: string; name: string; sku: string }>();
    for (const o of options) m.set(o.productId, { id: o.productId, name: o.productName, sku: o.productSku });
    return [...m.values()];
  }, [options]);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const revs = options.filter((o) => o.productId === productId);
  const [revisionId, setRevisionId] = useState(revs[0]?.revisionId ?? "");
  const rev = options.find((o) => o.revisionId === revisionId) ?? revs[0];
  const refKg = rev ? D(rev.referenceBatchSizeG).div(1000).toString() : "";
  const [sizeKg, setSizeKg] = useState(refKg);

  let factor: string | null = null;
  let theoYieldKg: string | null = null;
  try {
    if (rev && sizeKg && D(sizeKg).gt(0)) {
      factor = D(sizeKg).mul(1000).div(rev.referenceBatchSizeG).toDecimalPlaces(4).toString();
      theoYieldKg = fmtQty(D(sizeKg).mul(rev.theoreticalYieldPct).div(100), "kg", 2);
    }
  } catch {
    factor = null;
  }
  const fe = state?.fieldErrors ?? {};

  return (
    <Card>
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <Field label="Product" htmlFor="productId">
          <Select
            id="productId"
            value={productId}
            onChange={(e) => {
              const pid = e.target.value;
              setProductId(pid);
              const first = options.find((o) => o.productId === pid);
              setRevisionId(first?.revisionId ?? "");
              if (first) setSizeKg(D(first.referenceBatchSizeG).div(1000).toString());
            }}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Approved formula revision" htmlFor="formulaRevisionId" error={fe.formulaRevisionId}>
          <Select
            id="formulaRevisionId"
            name="formulaRevisionId"
            value={rev?.revisionId ?? ""}
            onChange={(e) => {
              setRevisionId(e.target.value);
              const r = options.find((o) => o.revisionId === e.target.value);
              if (r) setSizeKg(D(r.referenceBatchSizeG).div(1000).toString());
            }}
          >
            {revs.map((r) => (
              <option key={r.revisionId} value={r.revisionId}>
                {r.formulaCode} · revision {r.revisionNo} · {r.formulaName}
              </option>
            ))}
          </Select>
        </Field>

        {rev && (
          <div className="rounded-[12px] border border-line bg-surface-2/60 p-3.5">
            <Dl
              items={[
                ["Formula", `${rev.formulaCode} rev ${rev.revisionNo}`],
                ["Reference size", fmtQty(D(rev.referenceBatchSizeG).div(1000), "kg", 1)],
                ["Theoretical yield", `${fmtQty(rev.theoreticalYieldPct, "%", 1)}`],
                ["Ingredients", String(rev.lineCount)],
                ["Routing", rev.routingLabel ? `${rev.routingLabel} · ${rev.stepCount} steps` : "No approved routing"],
                ["Effective from", rev.effectiveFrom ?? "—"],
                ["Scale factor", factor ? `× ${factor}` : "—"],
              ]}
            />
            <p className="mt-3 text-[12px] text-muted">The batch keeps a frozen copy (snapshot) of this formula revision and of the routing revision effective on the planned start date. Later changes do not affect it.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Planned batch size (kg)" htmlFor="plannedSizeKg" error={fe.plannedSizeKg} hint={theoYieldKg ? `Theoretical yield ${theoYieldKg}` : undefined}>
            <Input id="plannedSizeKg" name="plannedSizeKg" inputMode="decimal" value={sizeKg} onChange={(e) => setSizeKg(e.target.value)} required />
          </Field>
          <Field label="Planned start date" htmlFor="plannedStartOn" error={fe.plannedStartOn}>
            <Input id="plannedStartOn" name="plannedStartOn" type="date" defaultValue={today} required />
          </Field>
        </div>

        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Creating batch…">
          Create batch
        </SubmitButton>
      </form>
    </Card>
  );
}
