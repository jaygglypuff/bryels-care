"use client";
import { useState } from "react";
import { Field, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { savePolicyAction } from "../actions";

/** "Tell me when an item runs low": item, the lowest amount we want on the shelf; the rest folded. Friendly units; the server converts. */
export function PolicyForm({ materials, suppliers }: { materials: { id: string; name: string; baseUom: string }[]; suppliers: { id: string; name: string }[] }) {
  const [mid, setMid] = useState("");
  const base = materials.find((m) => m.id === mid)?.baseUom ?? "";
  return (
    <ActionForm action={savePolicyAction} hidden={{ baseUom: base }} submit="Save" variant="secondary">
      {(fe) => (
        <>
          <Field label="Item" htmlFor="materialId" error={fe.materialId}>
            <Select id="materialId" name="materialId" required value={mid} onChange={(e) => setMid(e.target.value)}>
              <option value="" disabled>
                Pick an item…
              </option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tell me when we have less than" htmlFor="minStockBase" error={fe.minStockBase}>
            <QtyUnitInput id="minStockBase" baseUom={base || "*"} name="minStockBase" unitName="minStockBaseUnit" required />
          </Field>
          <MoreDetails>
            <Field label="Extra to keep for safety" htmlFor="safetyStockBase" error={fe.safetyStockBase}>
              <QtyUnitInput id="safetyStockBase" baseUom={base || "*"} name="safetyStockBase" unitName="safetyStockBaseUnit" />
            </Field>
            <Field label="Buy from" htmlFor="preferredSupplierId">
              <Select id="preferredSupplierId" name="preferredSupplierId" defaultValue="">
                <option value="">The supplier who delivers fastest</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Watch this item" htmlFor="isActive">
              <Select id="isActive" name="isActive" defaultValue="yes">
                <option value="yes">Yes</option>
                <option value="no">No, stop watching</option>
              </Select>
            </Field>
          </MoreDetails>
        </>
      )}
    </ActionForm>
  );
}
