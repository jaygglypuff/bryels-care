/**
 * ADR-110 C18 (end-to-end walk P14): which scans carry the counted loose pieces. A lot QR label (`BC:LOT:<lot>`) always
 * does. A lot number typed by hand (or sent by a scanner without the prefix) does too when pieces were typed: before,
 * only the QR payload carried the count, so a typed lot number lost it and the screen asked for the count again.
 * Box labels (`BC:BOX:<n>`, or a box number such as `BX-00000005`) never carry it. Pure; unit-tested in
 * tests/unit/scan-qty.test.ts. The server decides what the value is (packing.ts / picking.ts try a typed number as a
 * box, then as a lot) and refuses loose units beyond the pick.
 */
export type ScanQty = { isLotLabel: boolean; qty: string | null };

const BOX = /^(BC:BOX:|BX-)/i;
const LOT = /^BC:LOT:/i;
const NUMBER = /^\d+(\.\d+)?$/;

export function scanQty(value: string, typedQty: string): ScanQty {
  const v = value.trim();
  const q = typedQty.trim();
  if (LOT.test(v)) return { isLotLabel: true, qty: q || null };
  if (BOX.test(v)) return { isLotLabel: false, qty: null };
  // A plain value: a lot number typed by hand keeps the counted pieces when they were typed.
  return { isLotLabel: false, qty: q && NUMBER.test(q) ? q : null };
}
