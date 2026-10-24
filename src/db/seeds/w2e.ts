/**
 * Wave 2 W2E demo data (fictional): a custom role cloned from a template, an invited person waiting
 * to accept (an administrator can resend the link from the Users page) and a time-limited assignment.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW2E(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  const O = org.id;
  const role = async (code: string) => (await db.select().from(s.roles).where(and(eq(s.roles.organizationId, O), eq(s.roles.code, code))))[0];
  const site = async (code: string) => (await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, code))))[0];
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const admin = await user("admin@bryels-care.test");
  const nfd = await site("NFD");
  const rvs = await site("RVS");

  // Custom role: a read-mostly warehouse helper cloned from the warehouse operator template.
  const wo = await role("warehouse_operator");
  const keep = (await db.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, wo.id)))
    .map((r) => r.permissionCode)
    .filter((p) => p.endsWith(".view") || p === "inventory.stock_count.create" || p === "inventory.stock_count.submit");
  const [helper] = await db
    .insert(s.roles)
    .values({ organizationId: O, code: "stock_counter", name: "Stock counter (custom)", description: "Counts stock and looks up lots; cannot move stock.", isSystem: false, clonedFromRoleId: wo.id, createdBy: admin.id })
    .returning();
  await db.insert(s.rolePermissions).values(keep.map((p) => ({ roleId: helper.id, permissionCode: p })));

  // An invited person (fictional) with a pending invitation; nobody knows this random token, use "Resend".
  const [inv] = await db.insert(s.users).values({ organizationId: O, email: "joy.ramos@bryels-care.test", displayName: "Joy Ramos", passwordHash: "!", status: "invited" }).returning();
  await db.insert(s.userSiteAssignments).values({ userId: inv.id, roleId: helper.id, siteId: rvs.id, createdBy: admin.id });
  await db.insert(s.invitations).values({
    organizationId: O,
    userId: inv.id,
    email: inv.email,
    roleId: helper.id,
    siteId: rvs.id,
    tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
    expiresAt: new Date(Date.now() + 72 * 3_600_000),
    createdBy: admin.id,
  });

  // Temporary cover: the RVS warehouse operator also counts stock at NFD for the next 30 days.
  const carlo = await user("warehouse.rvs@bryels-care.test");
  await db.insert(s.userSiteAssignments).values({ userId: carlo.id, roleId: helper.id, siteId: nfd.id, validTo: new Date(Date.now() + 30 * 86_400_000), createdBy: admin.id });
}
