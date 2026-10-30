"use client";

/**
 * BRAND SLOT (S6 / ADR-077 hand-over). The tablet receive form keeps a place for a "Brand" field as the
 * fourth main field of every receipt line (after Quantity, Supplier lot no. and Expiry date). The brand
 * stream fills this component in: render a <Field label="Brand"> here, keep its value in the line state and
 * add `brand` to the line payload (receive-form.tsx `payload`) and to `LineSchema` in ./actions.ts.
 *
 * Until then it renders nothing and the grid simply has three fields.
 */
export type BrandSlotProps = {
  lineKey: number;
  lineIndex: number;
  materialId: string;
  error?: string;
};

export function ReceiveLineBrandSlot(_props: BrandSlotProps) {
  return null;
}
