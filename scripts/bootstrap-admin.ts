/**
 * First-administrator bootstrap (docs/deployment-railway.md "First administrator"; README).
 *
 *   BOOTSTRAP_ADMIN_EMAIL=owner@example.com BOOTSTRAP_ADMIN_NAME="Ana Villanueva" \
 *   BOOTSTRAP_ORG_NAME="Bryel's Care Corporation" BOOTSTRAP_SITE_CODE=NFD BOOTSTRAP_SITE_NAME="North Fields Plant" \
 *   pnpm admin:bootstrap
 *
 * Prints a one-time invitation link (valid 72 hours). Refuses when any person is already active or
 * locked. Never sets or prints a password. `pnpm admin:bootstrap --sync-roles` only re-synchronises the
 * seeded role templates with the code (after a release that changed role bundles).
 *
 * Optional: BOOTSTRAP_ADMIN_ROLES (comma list of owner_director, system_admin; default both),
 * APP_ORIGIN (used to build the link).
 */
import "dotenv/config";
import { applyRuntimeDefaults } from "../src/lib/runtime-env";

// APP_ORIGIN from Railway's public domain when unset (ADR-055), so the printed link is the public address.
applyRuntimeDefaults(process.env);

async function main() {
  // Uses the migration role when set (the bootstrap writes roles and the organization).
  if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;
  const { bootstrapFirstAdmin, syncAllSystemRoles, BOOTSTRAP_ROLES } = await import("../src/modules/identity/bootstrap");
  if (process.argv.includes("--sync-roles")) {
    const r = await syncAllSystemRoles();
    console.log(`Seeded role templates synchronised: ${JSON.stringify(r)}`);
    return;
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL to the email of the first administrator.");
  const roles = (process.env.BOOTSTRAP_ADMIN_ROLES || BOOTSTRAP_ROLES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const r = await bootstrapFirstAdmin({
    email,
    displayName: process.env.BOOTSTRAP_ADMIN_NAME || email.split("@")[0],
    roleCodes: roles as (typeof BOOTSTRAP_ROLES)[number][],
    organizationName: process.env.BOOTSTRAP_ORG_NAME || null,
    siteCode: process.env.BOOTSTRAP_SITE_CODE || null,
    siteName: process.env.BOOTSTRAP_SITE_NAME || null,
  });
  if (!process.env.APP_ORIGIN) console.warn("APP_ORIGIN is not set: the link below uses http://localhost:3000. Replace the origin with your public address.");
  console.log(
    [
      "",
      `First administrator invited: ${email} (${roles.join(" + ")}).`,
      r.createdOrganization ? "Created the organization." : "Organization found.",
      r.createdSite ? "Created the first site." : "Site(s) found.",
      `Seeded roles: created ${r.roleSync.created.length}, permissions added ${r.roleSync.added}, removed ${r.roleSync.removed}.`,
      `Reference data: +${r.referenceData.uoms} units, +${r.referenceData.conversions} conversions, +${r.referenceData.reasonCodes} reason codes.`,
      "",
      "Open this one-time link to set the password (it is not stored anywhere and works once):",
      r.link,
      `It expires at ${r.expiresAt.toISOString()}. Run the command again for a new link if it expires.`,
      "",
    ].join("\n"),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
