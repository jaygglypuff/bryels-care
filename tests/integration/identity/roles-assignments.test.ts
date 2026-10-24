/**
 * W2E US-1-17 (catalogue, seeded roles read-only), US-1-29 (custom roles by cloning), US-1-18 (site
 * assignments, switcher scope), US-2-29 (warehouse write sub-scope).
 * Test ids: identity.seeded_role_read_only, authz.role_escalation.custom_role_sensitivity, identity.no_self_grant,
 * identity.org_wide_only_three_roles, identity.site_manager_cannot_grant, identity.assignment_change_audited_and_effective,
 * identity.site_switcher_lists_allowed_sites, authz.subscope.warehouse_write.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, locations, rolePermissions, roles, settings, userSiteAssignments, warehouses } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { type Permission, PERMISSIONS } from "@/lib/permissions";
import {
  changeAssignmentScope,
  cloneRole,
  deactivateCustomRole,
  deleteCustomRole,
  endAssignment,
  getRole,
  grantAssignment,
  permissionCatalogue,
  roleMatrix,
  updateCustomRole,
} from "@/modules/identity";
import { postMovement } from "@/modules/inventory/ledger";
import { resetTestDatabase } from "../../support/db";
import { asUser, loadKit, loc, makeLot } from "../../support/kit";
import { customCtx, expectCode, idKit, roleId, signedIn, userByEmail } from "./helpers";

let k: Awaited<ReturnType<typeof idKit>>;

beforeAll(async () => {
  await resetTestDatabase();
  k = await idKit();
}, 180_000);

describe("US-1-17 catalogue and seeded roles", () => {
  it("the matrix renders every catalogue string with its sensitivity", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const m = await roleMatrix(admin);
    expect(m.catalogue.map((c) => c.code).sort()).toEqual([...PERMISSIONS].sort());
    expect(m.catalogue.find((c) => c.code === "identity.role.admin")?.sensitivity).toBe("R");
    expect(m.catalogue.find((c) => c.code === "identity.session.void")?.sensitivity).toBe("S");
    expect(m.roles.length).toBeGreaterThanOrEqual(10);
    expect(permissionCatalogue().length).toBe(PERMISSIONS.length);
  });

  it("identity.seeded_role_read_only: adding inventory.adjustment.approve to seeded site_manager is refused and audited", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const sm = await roleId(k.orgId, "site_manager");
    const before = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, sm));
    await expectCode(updateCustomRole(admin, sm, { name: "Site Manager", permissions: [...before.map((p) => p.permissionCode), "inventory.adjustment.approve"], reason: "try to widen" }), "forbidden");
    const after = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, sm));
    expect(after.length).toBe(before.length);
    const [d] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.authorization.denied"), eq(auditEvents.entityId, sm)));
    expect(d.reason).toMatch(/read-only/);
    await expectCode(deactivateCustomRole(admin, sm, "should not work"), "forbidden");
  });

  it("separation-of-duties warnings list record types a role can both submit and approve", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const d = await getRole(admin, await roleId(k.orgId, "site_manager"));
    expect(d.sodWarnings).toContain("inventory.stock_count");
    expect(d.role.isSystem).toBe(true);
  });
});

describe("US-1-29 custom roles by cloning", () => {
  it("authz.role_escalation.custom_role_sensitivity: a clone cannot exceed the creator's grants", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const wo = await roleId(k.orgId, "warehouse_operator");
    const woPerms = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, wo))).map((p) => p.permissionCode);
    // system_admin does not hold inventory.movement.post: keeping it in the clone is refused.
    const e = await expectCode(cloneRole(admin, { sourceRoleId: wo, code: "wh_viewer", name: "Warehouse viewer", permissions: woPerms }), "forbidden");
    expect(e.message).toMatch(/inventory\.movement\.post/);
    expect(await db.select().from(roles).where(eq(roles.code, "wh_viewer"))).toHaveLength(0);
    // Only what the creator holds: accepted, audited with the diff.
    const keep = woPerms.filter((p) => admin.can(p as never));
    const id = await cloneRole(admin, { sourceRoleId: wo, code: "wh_viewer", name: "Warehouse viewer", permissions: keep });
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.role.created"), eq(auditEvents.entityId, id)));
    expect((ev.after as { removed: string[] }).removed).toContain("inventory.movement.post");
    // Adding a string the creator lacks later is refused too.
    await expectCode(updateCustomRole(admin, id, { name: "Warehouse viewer", permissions: [...keep, "sales.shipment.post"], reason: "widen the role" }), "forbidden");
  });

  it("a role that administers access cannot also release quality (admin-incompatible mix)", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const mixed = customCtx(admin, [...admin.permissions, "quality.disposition.approve"]);
    const sa = await roleId(k.orgId, "system_admin");
    const saPerms = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, sa))).map((p) => p.permissionCode);
    const e = await expectCode(cloneRole(mixed, { sourceRoleId: sa, code: "sa_plus_qa", name: "Admin plus QA", permissions: [...saPerms, "quality.disposition.approve"] }), "forbidden");
    expect(e.message).toMatch(/administers access/);
  });

  it("owner clones a full bundle; deletion is refused once assigned, deactivation ends the assignments", async () => {
    const owner = await signedIn("owner@bryels-care.test");
    const wo = await roleId(k.orgId, "warehouse_operator");
    const woPerms = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, wo))).map((p) => p.permissionCode);
    const id = await cloneRole(owner, { sourceRoleId: wo, code: "qa_sampler", name: "QA sampler", permissions: woPerms.filter((p) => p !== "sales.shipment.post" && owner.can(p as Permission)) });
    const [bg] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.role.owner_break_glass"), eq(auditEvents.entityId, id)));
    expect(bg).toBeTruthy();
    const u = await userByEmail("warehouse.rvs@bryels-care.test");
    await grantAssignment(owner, { userId: u.id, roleId: id, siteId: k.rvs.id });
    await expectCode(deleteCustomRole(owner, id), "state");
    const ended = await deactivateCustomRole(owner, id, "Job no longer exists");
    expect(ended).toBe(1);
    const live = await db.select().from(userSiteAssignments).where(and(eq(userSiteAssignments.roleId, id)));
    expect(live[0].revokedAt).not.toBeNull();
    const id2 = await cloneRole(owner, { sourceRoleId: wo, code: "never_used", name: "Never used", permissions: ["inventory.lot.view"] });
    await deleteCustomRole(owner, id2);
    expect(await db.select().from(roles).where(eq(roles.id, id2))).toHaveLength(0);
  });
});

describe("US-1-18 site assignments", () => {
  it("identity.assignment_change_audited_and_effective: warehouse_operator → site_manager at NFD applies on the next request", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const owner = await signedIn("owner@bryels-care.test");
    const u = await userByEmail("warehouse.nfd@bryels-care.test");
    const [old] = await db.select().from(userSiteAssignments).where(eq(userSiteAssignments.userId, u.id));
    const before = await buildContextForUser(u.id);
    expect(before!.can("inventory.adjustment.approve")).toBe(false);
    const smRole = await roleId(k.orgId, "site_manager");
    // site_manager carries restricted strings system_admin lacks: by default only the owner grants it (A-W2E-02).
    await expectCode(grantAssignment(admin, { userId: u.id, roleId: smRole, siteId: k.nfd.id }), "forbidden");
    await db.insert(settings).values({ organizationId: k.orgId, scope: "organization", key: "identity.assignment.restricted_grant_requires_owner", value: false });
    await grantAssignment(admin, { userId: u.id, roleId: smRole, siteId: k.nfd.id, reason: "Promoted to site manager" });
    await db.delete(settings).where(eq(settings.key, "identity.assignment.restricted_grant_requires_owner"));
    await endAssignment(admin, old.id, "Promoted to site manager");
    const after = await buildContextForUser(u.id);
    expect(after!.can("inventory.adjustment.approve")).toBe(true);
    expect(after!.roleCodes).toEqual(["site_manager"]);
    const evs = await db.select({ action: auditEvents.action, before: auditEvents.before }).from(auditEvents).where(and(eq(auditEvents.entityType, "user_site_assignments"), eq(auditEvents.entityNumber, u.email)));
    expect(evs.map((e) => e.action)).toEqual(expect.arrayContaining(["identity.site_assignment.granted", "identity.site_assignment.revoked"]));
    // Restore for later tests (the owner ends the site_manager grant: it carries strings system_admin lacks).
    await grantAssignment(admin, { userId: u.id, roleId: await roleId(k.orgId, "warehouse_operator"), siteId: k.nfd.id });
    const [smAsg] = await db.select().from(userSiteAssignments).where(and(eq(userSiteAssignments.userId, u.id), eq(userSiteAssignments.roleId, smRole)));
    await endAssignment(owner, smAsg.id, "Back to the warehouse");
    expect((await buildContextForUser(u.id))!.roleCodes).toEqual(["warehouse_operator"]);
  });

  it("identity.no_self_grant, identity.org_wide_only_three_roles, identity.site_manager_cannot_grant", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    await expectCode(grantAssignment(admin, { userId: admin.userId, roleId: await roleId(k.orgId, "warehouse_operator"), siteId: k.nfd.id }), "forbidden");
    const u = await userByEmail("sales@bryels-care.test");
    await expectCode(grantAssignment(admin, { userId: u.id, roleId: await roleId(k.orgId, "warehouse_operator"), siteId: null }), "validation");
    const sm = await signedIn("manager.nfd@bryels-care.test");
    await expectCode(grantAssignment(sm, { userId: u.id, roleId: await roleId(k.orgId, "warehouse_operator"), siteId: k.nfd.id }), "forbidden");
  });

  it("a site-scoped assignment administrator cannot reach another site, nor grant organization-wide", async () => {
    // A custom role carrying identity.site_assignment.admin, granted to the NFD site manager at NFD only.
    const owner = await signedIn("owner@bryels-care.test");
    const smRole = await roleId(k.orgId, "site_manager");
    const smPerms = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, smRole))).map((p) => p.permissionCode);
    const custom = await cloneRole(owner, { sourceRoleId: smRole, code: "site_user_admin", name: "Site user admin", permissions: [...smPerms.filter((p) => owner.can(p as Permission)), "identity.site_assignment.admin"] });
    const mgr = await userByEmail("manager.nfd@bryels-care.test");
    await grantAssignment(owner, { userId: mgr.id, roleId: custom, siteId: k.nfd.id });
    const sm = await signedIn("manager.nfd@bryels-care.test");
    const target = await userByEmail("sales@bryels-care.test");
    const wo = await roleId(k.orgId, "warehouse_operator");
    await expectCode(grantAssignment(sm, { userId: target.id, roleId: wo, siteId: k.rvs.id }), "not_found");
    await expectCode(grantAssignment(sm, { userId: target.id, roleId: await roleId(k.orgId, "auditor"), siteId: null }), "forbidden");
    // At its own site it works, but a role with restricted permissions it lacks (qa_qc) is refused.
    await grantAssignment(sm, { userId: target.id, roleId: wo, siteId: k.nfd.id });
    await expectCode(grantAssignment(sm, { userId: target.id, roleId: await roleId(k.orgId, "qa_qc"), siteId: k.nfd.id }), "forbidden");
  });

  it("validity dates: a future assignment grants nothing yet; identity.site_switcher_lists_allowed_sites", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const u = await userByEmail("operator.nfd@bryels-care.test");
    const before = await buildContextForUser(u.id);
    expect(before!.allowedSiteIds).toEqual([k.nfd.id]);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await grantAssignment(admin, { userId: u.id, roleId: await roleId(k.orgId, "warehouse_operator"), siteId: k.rvs.id, validFrom: tomorrow });
    expect((await buildContextForUser(u.id))!.allowedSiteIds).toEqual([k.nfd.id]);
    const owner = await buildContextForUser((await userByEmail("owner@bryels-care.test")).id);
    expect(owner!.allowedSiteIds.sort()).toEqual([k.nfd.id, k.rvs.id].sort());
    expect(owner!.isOrganizationWide).toBe(true);
  });
});

describe("US-2-29 warehouse write sub-scope", () => {
  it("authz.subscope.warehouse_write: a movement into an unlisted warehouse is 404 and writes nothing; listed ones work", async () => {
    const [wh1] = await db.select().from(warehouses).where(and(eq(warehouses.siteId, k.nfd.id), eq(warehouses.code, "WH1")));
    const [wh2] = await db.insert(warehouses).values({ siteId: k.nfd.id, code: "WH2", name: "Overflow warehouse (fictional)" }).returning();
    const [w2loc] = await db.insert(locations).values({ siteId: k.nfd.id, warehouseId: wh2.id, code: "W2-01", name: "Overflow rack", kind: "storage" }).returning();
    const kit = await loadKit();
    const seedCtx = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const a01 = await loc(k.nfd.id, "A-01");
    const a02 = await loc(k.nfd.id, "A-02");
    const lot = await makeLot(seedCtx, k.nfd.id, a01.id, "100");

    const admin = await signedIn("admin@bryels-care.test");
    const u = await userByEmail("warehouse.nfd@bryels-care.test");
    const [asg] = await db
      .select()
      .from(userSiteAssignments)
      .where(and(eq(userSiteAssignments.userId, u.id), eq(userSiteAssignments.siteId, k.nfd.id), eq(userSiteAssignments.roleId, await roleId(k.orgId, "warehouse_operator"))))
      .orderBy(userSiteAssignments.createdAt);
    const live = (await db.select().from(userSiteAssignments).where(eq(userSiteAssignments.userId, u.id))).filter((a) => !a.revokedAt);
    await changeAssignmentScope(admin, live.find((a) => a.siteId === k.nfd.id)?.id ?? asg.id, [wh1.id], "Works in the main warehouse only");
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.action, "identity.site_assignment.scope_changed"));
    expect((ev.after as { scope: { warehouseIds: string[] } }).scope.warehouseIds).toEqual([wh1.id]);

    const ctx = await buildContextForUser(u.id);
    expect(ctx!.warehouseScope(k.nfd.id)).toEqual([wh1.id]);
    await expectCode(
      db.transaction((tx) => postMovement(tx, ctx!, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: w2loc.id, qtyBase: "10", sourceDocumentType: "test" })),
      "not_found",
    );
    await db.transaction((tx) => postMovement(tx, ctx!, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qtyBase: "10", sourceDocumentType: "test" }));
    // Clearing the scope restores the whole site.
    await changeAssignmentScope(admin, live.find((a) => a.siteId === k.nfd.id)?.id ?? asg.id, null, "Covers both warehouses again");
    const ctx2 = await buildContextForUser(u.id);
    expect(ctx2!.warehouseScope(k.nfd.id)).toBeNull();
    await db.transaction((tx) => postMovement(tx, ctx2!, { movementType: "transfer", lotId: lot.id, fromLocationId: a02.id, toLocationId: w2loc.id, qtyBase: "5", sourceDocumentType: "test" }));
    // A warehouse of another site is refused as a scope value.
    const [rvsWh] = await db.select().from(warehouses).where(eq(warehouses.siteId, k.rvs.id));
    await expectCode(changeAssignmentScope(admin, live.find((a) => a.siteId === k.nfd.id)?.id ?? asg.id, [rvsWh.id], "Wrong site warehouse"), "validation");
  });
});
