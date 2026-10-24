"use server";
import type { ActionState } from "@/lib/errors";
import {
  assignEquipmentToLine,
  changeEquipmentBlockingRule,
  changeLineStatus,
  changeLocationStatus,
  changeMaterialStatus,
  changeProductStatus,
  changeSkuStatus,
  createDepartment,
  createLine,
  createLocation,
  createMaterialMaster,
  createProduct,
  createReasonCode,
  createSite,
  createSku,
  createUom,
  createWarehouse,
  decideConversion,
  designateSpecialLocation,
  proposeConversion,
  setSiteActive,
  setWarehouseActive,
  updateDepartment,
  updateLine,
  updateLocation,
  updateMaterial,
  updateProduct,
  updateReasonCode,
  updateSite,
  updateSku,
  updateUom,
  updateWarehouse,
} from "@/modules/masterdata";
import { act, field, formInput } from "./act";

/** Server actions for the W2G master data screens (thin adapters over src/modules/masterdata). */
type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const id = (fd: FormData) => field(fd, "_id");
const active = (fd: FormData) => field(fd, "_active") === "true";

/* sites and departments */
export const saveSiteAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateSite(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/sites"], message: "Site saved." })
    : act((ctx) => createSite(ctx, formInput(fd)), { revalidate: ["/masterdata/sites"], redirectTo: (s) => `/masterdata/sites/${s.id}?saved=1` });
export const siteActiveAction: A = async (_p, fd) =>
  act((ctx) => setSiteActive(ctx, { siteId: id(fd), active: active(fd), reason: field(fd, "reason") }), { revalidate: ["/masterdata/sites"], message: active(fd) ? "Site reactivated." : "Site deactivated." });
export const saveDepartmentAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateDepartment(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/sites"], message: "Department saved." })
    : act((ctx) => createDepartment(ctx, formInput(fd)), { revalidate: ["/masterdata/sites"], message: "Department added." });

/* warehouses and special locations */
export const saveWarehouseAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateWarehouse(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/warehouses"], message: "Warehouse saved." })
    : act((ctx) => createWarehouse(ctx, formInput(fd)), { revalidate: ["/masterdata/warehouses"], redirectTo: (w) => `/masterdata/warehouses/${w.id}?created=1` });
export const warehouseActiveAction: A = async (_p, fd) =>
  act((ctx) => setWarehouseActive(ctx, { warehouseId: id(fd), active: active(fd), reason: field(fd, "reason") }), { revalidate: ["/masterdata/warehouses"], message: active(fd) ? "Warehouse reactivated." : "Warehouse deactivated." });
export const designateAction: A = async (_p, fd) =>
  act((ctx) => designateSpecialLocation(ctx, formInput(fd)), {
    revalidate: ["/masterdata/warehouses", "/masterdata/locations"],
    message: (r) => (r.missing.length ? `Designated. Still missing: ${r.missing.join(", ")}.` : "Designated. Every special location is set."),
  });

/* locations */
export const saveLocationAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateLocation(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/locations"], message: "Location saved." })
    : act((ctx) => createLocation(ctx, formInput(fd)), { revalidate: ["/masterdata/locations"], redirectTo: (l) => `/masterdata/locations/${l.id}?created=1` });
export const locationStatusAction: A = async (_p, fd) =>
  act((ctx) => changeLocationStatus(ctx, { locationId: id(fd), status: field(fd, "status"), reason: field(fd, "reason") }), { revalidate: ["/masterdata/locations"], message: (l) => `Location is now ${l.status}.` });

/* lines and equipment */
export const saveLineAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateLine(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/lines"], message: "Line saved." })
    : act((ctx) => createLine(ctx, formInput(fd)), { revalidate: ["/masterdata/lines"], redirectTo: (l) => `/masterdata/lines/${l.id}?created=1` });
export const lineStatusAction: A = async (_p, fd) =>
  act((ctx) => changeLineStatus(ctx, { lineId: id(fd), status: field(fd, "status"), reason: field(fd, "reason") }), { revalidate: ["/masterdata/lines"], message: (l) => `Line is now ${l.status}.` });
export const assignEquipmentAction: A = async (_p, fd) =>
  act((ctx) => assignEquipmentToLine(ctx, formInput(fd)), { revalidate: ["/masterdata/lines", "/masterdata/equipment"], message: "Equipment assignment saved." });
export const blockingRuleAction: A = async (_p, fd) =>
  act((ctx) => changeEquipmentBlockingRule(ctx, formInput(fd)), { revalidate: ["/masterdata/lines", "/masterdata/equipment"], message: "Blocking rule saved." });

/* units and conversions */
export const saveUomAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateUom(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/uom"], message: "Unit saved." })
    : act((ctx) => createUom(ctx, formInput(fd)), { revalidate: ["/masterdata/uom"], message: "Unit added." });
export const proposeConversionAction: A = async (_p, fd) =>
  act((ctx) => proposeConversion(ctx, formInput(fd)), { revalidate: ["/masterdata/uom"], message: "Conversion submitted. A second administrator must approve it before it is used." });
export const decideConversionAction: A = async (_p, fd) =>
  act((ctx) => decideConversion(ctx, { id: id(fd), decision: field(fd, "decision"), note: field(fd, "note") }), { revalidate: ["/masterdata/uom"], message: (r) => `Conversion ${r.status}.` });

/* products and SKUs */
export const saveProductAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateProduct(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/products"], message: "Product saved." })
    : act((ctx) => createProduct(ctx, formInput(fd)), { revalidate: ["/masterdata/products"], redirectTo: (p) => `/masterdata/products/${p.id}?created=1` });
export const productStatusAction: A = async (_p, fd) =>
  act((ctx) => changeProductStatus(ctx, { id: id(fd), status: field(fd, "status"), reason: field(fd, "reason") }), { revalidate: ["/masterdata/products"], message: (p) => `Product is now ${p.status}.` });
export const saveSkuAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateSku(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/products"], message: "SKU saved." })
    : act((ctx) => createSku(ctx, formInput(fd)), { revalidate: ["/masterdata/products"], redirectTo: (s) => `/masterdata/products/${s.productId}/skus/${s.id}?created=1` });
export const skuStatusAction: A = async (_p, fd) =>
  act((ctx) => changeSkuStatus(ctx, { id: id(fd), status: field(fd, "status"), reason: field(fd, "reason") }), { revalidate: ["/masterdata/products"], message: (s) => `SKU is now ${s.status}.` });

/* materials */
export const saveMaterialAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateMaterial(ctx, id(fd), formInput(fd)), { revalidate: ["/masterdata/materials"], message: (m) => (m.warnings.length ? `Saved. ${m.warnings.join(" ")}` : "Material saved.") })
    : act((ctx) => createMaterialMaster(ctx, formInput(fd)), { revalidate: ["/masterdata/materials"], redirectTo: (m) => `/masterdata/materials/${m.id}?created=1` });
export const materialStatusAction: A = async (_p, fd) =>
  act((ctx) => changeMaterialStatus(ctx, { id: id(fd), status: field(fd, "status"), reason: field(fd, "reason") }), { revalidate: ["/masterdata/materials"], message: (m) => `Material is now ${m.status}.` });

/* reason codes */
export const saveReasonCodeAction: A = async (_p, fd) =>
  id(fd)
    ? act((ctx) => updateReasonCode(ctx, id(fd), formInput(fd, ["appliesTo"])), { revalidate: ["/masterdata/reason-codes"], message: "Reason code saved." })
    : act((ctx) => createReasonCode(ctx, formInput(fd, ["appliesTo"])), { revalidate: ["/masterdata/reason-codes"], redirectTo: (r) => `/masterdata/reason-codes/${r.id}?created=1` });
