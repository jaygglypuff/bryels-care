/**
 * Empty sandbox company for the demo environment (ADR-072, docs/getting-started.md).
 *
 *   pnpm db:sandbox ensure   create the sandbox company when it is missing; otherwise do nothing.
 *                            Runs after `pnpm db:demo auto|reset` in scripts/start.sh and the reset.
 *
 * The sandbox is a second, separate organization next to the fictional demo company. It has only what
 * a new company needs to start working — one site with a warehouse and its basic locations, the role
 * templates, units, reason codes, the approved print templates and one or two accounts per role (so
 * separation-of-duties steps can be tried; the owner override is on, ADR-073) — and NO materials, products, suppliers, customers, stock,
 * batches or orders: the owner builds everything from scratch by following the getting-started guide.
 *
 * Same safety rules as the demo (src/lib/demo.ts): demo mode only, demo addresses only
 * (sandbox.*@bryels-care.test), refused while any real account exists. Every row is scoped to its own
 * organization, so nothing from the demo company is visible in the sandbox and the other way round.
 *
 * Exit codes: 0 done or nothing to do, 1 error, 2 refused.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEMO_PASSWORD, NON_DEMO_USER_PREDICATE, SANDBOX_ORG_NAME, SANDBOX_OWNER_EMAIL, demoModeState, realAccountsRefusal } from "../lib/demo";
import { ROLE_BUNDLES } from "../lib/permissions";
import { installReferenceData } from "../modules/masterdata/org-reference";
import * as s from "./schema";

const say = (msg: string) => console.log(`[sandbox] ${msg}`);

/** One or two people per role: the second person makes checker / approver steps possible. */
const PEOPLE: [email: string, name: string, role: string, orgWide: boolean][] = [
  ["sandbox.owner@bryels-care.test", "Sandbox Owner", "owner_director", true],
  ["sandbox.admin@bryels-care.test", "Sandbox Admin", "system_admin", true],
  ["sandbox.manager@bryels-care.test", "Sandbox Site Manager", "site_manager", false],
  ["sandbox.planner@bryels-care.test", "Sandbox Planner", "production_planner", false],
  ["sandbox.operator@bryels-care.test", "Sandbox Operator", "production_operator", false],
  ["sandbox.checker@bryels-care.test", "Sandbox Checker", "production_operator", false],
  ["sandbox.qa@bryels-care.test", "Sandbox QA", "qa_qc", false],
  ["sandbox.qa2@bryels-care.test", "Sandbox QA Lead", "qa_qc", false],
  ["sandbox.warehouse@bryels-care.test", "Sandbox Warehouse", "warehouse_operator", false],
  ["sandbox.warehouse2@bryels-care.test", "Sandbox Warehouse 2", "warehouse_operator", false],
  ["sandbox.procurement@bryels-care.test", "Sandbox Buyer", "procurement", false],
  ["sandbox.sales@bryels-care.test", "Sandbox Sales", "sales_cs", false],
  ["sandbox.finance@bryels-care.test", "Sandbox Finance", "finance", false],
  ["sandbox.finance2@bryels-care.test", "Sandbox Finance 2", "finance", false],
];

/** Basic locations of the sandbox warehouse: [code, name, kind, special role or null]. */
const LOCATIONS: [string, string, string, string | null][] = [
  ["RCV", "Receiving dock", "receiving", "receiving"],
  ["QUA-01", "Quarantine cage", "quarantine", "quarantine"],
  ["HLD-01", "QA hold cage", "hold", "hold"],
  ["REJ", "Rejected goods cage", "rejected", "rejected"],
  ["RCL", "Recall cage", "recall", "recall"],
  ["RM-01", "Raw materials rack", "storage", null],
  ["PKG-01", "Packaging shelf", "storage", null],
  ["STG-01", "Production staging", "staging", "staging"],
  ["PRD-01", "Production room", "production", null],
  ["FG-01", "Finished goods bay", "storage", null],
  ["SHP", "Dispatch bay", "shipping", null],
  ["RET-01", "Customer returns cage", "quarantine", null],
];

async function main(): Promise<number> {
  const mode = process.argv[2] ?? "ensure";
  if (mode !== "ensure") {
    console.error("Usage: pnpm db:sandbox ensure");
    return 1;
  }
  if (!demoModeState(process.env).on) return 0; // demo mode off: nothing to do, silently
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) {
    say("DATABASE_URL is not set.");
    return 1;
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: s });
  try {
    await client`select pg_advisory_lock(hashtext('bc_sandbox_data'))`;
    const [{ n: real }] = await client.unsafe<{ n: number }[]>(`select count(*)::int as n from users where ${NON_DEMO_USER_PREDICATE}`);
    if (real > 0) {
      say(realAccountsRefusal(real));
      return 2;
    }
    const [existing] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, SANDBOX_OWNER_EMAIL)).limit(1);
    if (existing) {
      say("The empty sandbox company is already there; nothing to do.");
      return 0;
    }
    const [demoOrg] = await db.select({ id: s.organizations.id }).from(s.organizations).orderBy(s.organizations.createdAt).limit(1);
    const pw = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

    await db.transaction(async (tx) => {
      const [org] = await tx.insert(s.organizations).values({ name: SANDBOX_ORG_NAME }).returning();
      const O = org.id;

      // Roles: the seeded, read-only role templates (identical to the demo company and production).
      const roleIds: Record<string, string> = {};
      for (const [code, b] of Object.entries(ROLE_BUNDLES)) {
        const [r] = await tx.insert(s.roles).values({ organizationId: O, code, name: b.name, allowsOrganizationWide: b.orgWide, isSystem: true }).returning();
        roleIds[code] = r.id;
        await tx.insert(s.rolePermissions).values([...new Set(b.permissions)].map((p) => ({ roleId: r.id, permissionCode: p })));
      }

      // One site, one warehouse and the basic locations, with the special locations designated.
      const [site] = await tx.insert(s.sites).values({ organizationId: O, code: "SBX", name: "Sandbox Plant" }).returning();
      const [wh] = await tx.insert(s.warehouses).values({ siteId: site.id, code: "WH1", name: "Main warehouse" }).returning();
      for (const [code, name, kind, role] of LOCATIONS) {
        // S6 (ADR-077): storage places get their warehouse section; the others are worked out from the class.
        const section = code === "RM-01" ? "raw_materials" : code === "PKG-01" ? "packaging" : code === "FG-01" ? "finished_goods" : null;
        const [loc] = await tx.insert(s.locations).values({ siteId: site.id, warehouseId: wh.id, code, name, kind, section }).returning();
        if (role) await tx.insert(s.warehouseSpecialLocations).values({ organizationId: O, siteId: site.id, warehouseId: wh.id, role, locationId: loc.id });
      }

      // The system actor (ADR-029) and the people.
      await tx.insert(s.users).values({ organizationId: O, email: "system@bryels-care.invalid", displayName: "System (scheduled jobs)", passwordHash: "!", status: "system" });
      const userIds: Record<string, string> = {};
      for (const [email, displayName, role, orgWide] of PEOPLE) {
        const [u] = await tx.insert(s.users).values({ organizationId: O, email, displayName, passwordHash: pw }).returning();
        userIds[email] = u.id;
        await tx.insert(s.userSiteAssignments).values(orgWide ? { userId: u.id, roleId: roleIds[role], isOrganizationWide: true } : { userId: u.id, roleId: roleIds[role], siteId: site.id });
      }
      const admin = userIds["sandbox.admin@bryels-care.test"];
      const qa = userIds["sandbox.qa@bryels-care.test"];

      // Units, conversions and reason codes (the same reference data a real company gets).
      await installReferenceData(tx, O);

      // Approved print templates (labels, BMR, dispensing sheet, traveler, pick list, DR, PO…) copied
      // from the demo company's approved versions, so printing works from the first receipt.
      if (demoOrg) {
        await tx.execute(sql`
          with src as (
            select t.*, gen_random_uuid() as new_id from document_templates t where t.organization_id = ${demoOrg.id} and t.site_id is null and t.is_active
          ), ins as (
            insert into document_templates (id, organization_id, site_id, code, name, template_kind, page_size, orientation, is_active, created_by, created_at, updated_at)
            select new_id, ${O}, null, code, name, template_kind, page_size, orientation, true, ${admin}, now(), now() from src
            returning id, code
          )
          insert into document_template_versions (id, document_template_id, version_no, status, definition, definition_checksum, change_note, created_by, created_at, updated_at, submitted_by, submitted_at, approved_by, approved_at, effective_from)
          select gen_random_uuid(), ins.id, 1, 'approved', v.definition, v.definition_checksum, 'Copied for the sandbox from the standard templates', ${admin}, now(), now(), ${admin}, now(), ${qa}, now(), now()
          from ins
          join src on src.code = ins.code
          join lateral (
            select definition, definition_checksum from document_template_versions dv
            where dv.document_template_id = src.id and dv.status = 'approved' order by dv.version_no desc limit 1
          ) v on true`);
        await tx.execute(sql`
          insert into label_templates (id, organization_id, site_id, code, name, document_template_id, applies_to, symbology, copies_default, fields, media_width_mm, media_height_mm, dpi, status, is_active, created_by, created_at, updated_by, updated_at, approved_by, approved_at)
          select gen_random_uuid(), ${O}, null, lt.code, lt.name, nt.id, lt.applies_to, lt.symbology, lt.copies_default, lt.fields, lt.media_width_mm, lt.media_height_mm, lt.dpi, 'approved', true, ${admin}, now(), ${admin}, now(), ${qa}, now()
          from label_templates lt
          join document_templates dt on dt.id = lt.document_template_id
          join document_templates nt on nt.organization_id = ${O} and nt.code = dt.code
          where lt.organization_id = ${demoOrg.id} and lt.site_id is null and lt.status = 'approved' and lt.is_active`);
      } else {
        say("No demo company found to copy print templates from; create them under Management → System → Templates & labels.");
      }
      await tx.insert(s.printStations).values({ organizationId: O, siteId: site.id, code: "SBX-DESK", name: "Warehouse desk printer", printerName: "Browser print (any printer)", createdBy: admin });

      // ADR-073: the owner can carry every step alone in the sandbox and in the demo company (the demo's
      // switch is set once, here, so an owner who turns it off later keeps it off).
      for (const orgId of [O, demoOrg?.id].filter((x): x is string => !!x)) {
        await tx.insert(s.settings).values({ organizationId: orgId, scope: "organization", key: "governance.owner_override", value: true, updatedBy: orgId === O ? admin : null }).onConflictDoNothing();
      }
      // ADR-080 §4 (supersedes ADR-078 §2): the sandbox checks only the formula lines marked "needs a check"; switchable in Settings.
      await tx.insert(s.settings).values({ organizationId: O, scope: "organization", key: "production.weighing.second_person_check", value: "marked", updatedBy: admin });
      await tx.insert(s.auditEvents).values({ organizationId: O, actorId: admin, action: "platform.sandbox.seeded", entityType: "organization", entityId: O, entityNumber: "SBX", after: { accounts: PEOPLE.length, site: "SBX" } });
    });

    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users).where(and(sql`${s.users.email} like 'sandbox.%'`));
    say(`Empty sandbox company created with ${count.n} accounts (password ${DEMO_PASSWORD}). Sign in with "Start from scratch" on the sign-in page.`);
    return 0;
  } finally {
    await client`select pg_advisory_unlock(hashtext('bc_sandbox_data'))`.catch(() => undefined);
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
