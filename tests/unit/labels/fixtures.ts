import type { LabelData } from "@/modules/documents/renderers/label-v1";
import type { DocumentMeta, FrozenDataset } from "@/modules/documents/renderers/types";

/** Fictional label datasets, one per label kind, used to pin the renderer output and test scannability. */
export const META: DocumentMeta = {
  documentNumber: "DOC-26-0000001",
  documentKind: "label",
  templateCode: "LBL-RM",
  templateName: "Raw material container label layout",
  templateVersionNo: 1,
  definitionChecksum: "0".repeat(64),
  watermark: null,
  recordRevisionNo: 1,
  reprintNo: 0,
  reprintOfNumber: null,
  sourceRevisionAt: "2026-10-01T00:00:00.000Z",
  sourceState: "quarantine",
  generatedAt: "2026-10-01T00:00:00.000Z",
  generatedByName: "Demo User",
  siteCode: "NFD",
  organizationName: "Demo Org (fictional)",
  traceRef: "01A19196",
};

const label = (appliesTo: string, fields: LabelData["label"]["fields"], w = 100, h = 50, symbology: "qr" | "code128" = "qr"): LabelData["label"] => ({ code: `LT-${appliesTo}`, appliesTo, symbology, mediaWidthMm: w, mediaHeightMm: h, dpi: 203, fields });

export const SACK: LabelData = {
  label: label("material", ["item_name", "inci_name", "supplier_lot", "supplier", "brand", "received", "expiry", "quantity", "storage", "status_word", "scan_to_verify"]),
  copies: 3,
  entity: {
    payloadType: "LOT",
    value: "L-2610-00001",
    caption: "RAW MATERIAL",
    itemCode: "MAT-0012",
    itemName: "Coconut Oil",
    inciName: "Cocos Nucifera (Coconut) Oil",
    supplierName: "Laguna Oleo Supply (fictional)",
    supplierLotNumber: "LOS-24871",
    brand: "Isla Gold (fictional)",
    receivedOn: "21 Sept 2026",
    expiresOn: "22 Jun 2028",
    expiryLabel: "Expiry",
    quantityText: "25 kg",
    storageConditions: "Cool, dry place",
    statusWord: "QUARANTINE",
  },
};

export const BAR: LabelData = {
  label: label("finished_good", ["item_name", "batch", "manufactured", "expiry", "storage"], 50, 30),
  copies: 120,
  entity: { payloadType: "LOT", value: "LOT-26-00042", caption: "SOAP", itemCode: "SKU-OAT-100", itemName: "Oat Milk Soap 100 g", batchNumber: "BM-2611-0001", manufacturedOn: "31 Oct 2026", expiresOn: "31 Oct 2028", expiryLabel: "Expiry", storageConditions: "Keep dry" },
};

export const SHELF: LabelData = {
  label: label("location", ["location_name", "warehouse", "location_kind", "allowed_statuses"], 100, 50, "code128"),
  copies: 1,
  entity: { payloadType: "LOC", value: "QUA-01", caption: "LOCATION", locationName: "Quarantine rack 1", warehouseCode: "WH1", locationKindWord: "QUARANTINE", allowedStatuses: "QUARANTINE, ON HOLD" },
};

export const BOX: LabelData = {
  label: label("carton", ["item_name", "batch", "expiry", "quantity", "packed", "packer", "box_of", "status_word"]),
  copies: 1,
  entity: { payloadType: "BOX", value: "BX-00000001", caption: "BOX", itemCode: "SKU-OAT-100", itemName: "Oat Milk Soap 100 g", batchNumber: "BM-2611-0001", expiresOn: "31 Oct 2028", expiryLabel: "Expiry", quantityText: "LOT-26-00042 · 48 pcs", statusWord: "RELEASED", packedOn: "31 Oct 2026", packerInitials: "JD", boxOfText: "1 of 3" },
};

export const frozen = (data: LabelData): FrozenDataset<LabelData> => ({ meta: META, data });
