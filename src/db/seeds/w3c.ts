/**
 * Wave 3 W3C demo seed: two saved import mapping profiles (a count-sheet export for opening stock and a
 * purchase-list export for materials) so the wizard shows how profiles are reused. No import job is
 * seeded: jobs need their original file in storage. Fictional data only; called from src/db/seed.ts.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW3c(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const [manager] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.organizationId, org.id), eq(s.users.email, "manager.nfd@bryels-care.test"))).limit(1);
  if (!manager) return;
  const formats = { dateFormat: "DD/MM/YYYY", decimalSeparator: ".", thousandsSeparator: "," };
  await db.insert(s.importMappings).values([
    {
      organizationId: org.id,
      code: "DEMO-COUNT-SHEET",
      name: "Demo count sheet export (fictional)",
      importKind: "opening_stock",
      definition: {
        ...formats,
        columns: { location_code: "Location", item_kind: "Type", item_code: "Item", supplier_lot_number: "Supplier lot", expiry_date: "Expiry", qty: "Counted", uom: "Unit", counted_by: "Counter", checked_by: "Checker", count_sheet_ref: "Sheet" },
      },
      createdBy: manager.id,
    },
    {
      organizationId: org.id,
      code: "DEMO-PURCHASE-LIST",
      name: "Demo purchase list export (fictional)",
      importKind: "materials",
      definition: { ...formats, columns: { code: "Item No", name: "Item Name", material_class: "Kind", uom_base: "Unit" } },
      createdBy: manager.id,
    },
  ]);
}
