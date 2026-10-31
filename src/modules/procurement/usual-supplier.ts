import "server-only";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { createMaterialMaster } from "@/modules/masterdata";
import { proposeSupplierMaterial, updateSupplierMaterialPack } from "./asl";
import { isUuid } from "./shared";

/**
 * ADR-088 "New material" in three questions plus the optional "Usual supplier and pack size".
 * One transaction: the material is created (masterdata rules, code MAT-nnnn), and when a usual
 * supplier is picked the supplier × material pair is proposed for the approved-supplier list (QA
 * still approves it, US-6-01) with the same pack size. Picking a supplier needs
 * `masterdata.supplier.edit`, like proposing a pair anywhere else.
 */
export async function createMaterialWithUsualSupplier(ctx: AuthContext, raw: Record<string, unknown>) {
  const { usualSupplierId, ...input } = raw;
  const supplierId = typeof usualSupplierId === "string" ? usualSupplierId.trim() : "";
  if (supplierId && !isUuid(supplierId)) throw new DomainError("validation", "Choose a supplier from the list.", { field: "usualSupplierId" });
  return db.transaction(async (tx) => {
    const m = await createMaterialMaster(ctx, input, { tx });
    if (supplierId) {
      const { supplierMaterialId } = await proposeSupplierMaterial(ctx, { supplierId, materialId: m.id, note: "Usual supplier, chosen when the material was added." }, { tx });
      if (m.standardPackQty || m.brand) await updateSupplierMaterialPack(ctx, { supplierMaterialId, brand: m.brand, packQty: m.standardPackQty, packUom: m.standardPackUom }, { tx });
    }
    return m;
  });
}
