import "server-only";
import type { ExportDefinition } from "@/lib/export";
import { listUsers, type UserListRow } from "./users";

/**
 * User list export (US-1-16 AC3): identity.user.export, the same scope as the Users screen, formula
 * neutralisation and `platform.export.created` audit via runExport. No credentials, no MFA data.
 */
export const userExportDefinition: ExportDefinition<{ status?: string }, UserListRow> = {
  code: "identity.users",
  title: "Users",
  permission: "identity.user.export",
  sensitivity: "S",
  columns: [
    { header: "Name", value: (r) => r.displayName, personalData: true },
    { header: "Email", value: (r) => r.email, personalData: true },
    { header: "Status", value: (r) => r.status },
    { header: "Roles", value: (r) => r.roles.join("; ") },
    { header: "Site scope", value: (r) => r.siteScope },
    { header: "Last sign-in", value: (r) => (r.lastLoginAt ? r.lastLoginAt.toISOString() : "") },
  ],
  fetch: async (ctx, filters, limit) => (await listUsers(ctx, { status: filters.status })).slice(0, limit),
  siteScope: (ctx) => ctx.allowedSiteIds,
  fileName: () => `users-${new Date().toISOString().slice(0, 10)}`,
};
