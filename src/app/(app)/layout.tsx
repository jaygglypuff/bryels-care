import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, inventoryLots } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { unreadNotificationCount } from "@/modules/platform";
import { myApprovalCount } from "@/modules/action-centre";
import { getMaintenanceState } from "@/lib/maintenance";
import { MaintenanceBanner } from "@/ui/maintenance-banner";
import { isDemoMode, isSandboxEmail } from "@/lib/demo";
import { buildNav, isApprover, tabsFor } from "./nav";
import { Shell } from "./shell";
import { signOut, switchSite } from "./actions";

export const dynamic = "force-dynamic";

async function openQaCount(siteId: string): Promise<number> {
  const [lots] = await db.select({ n: count() }).from(inventoryLots).where(and(eq(inventoryLots.siteId, siteId), eq(inventoryLots.qualityStatus, "quarantine")));
  const [bs] = await db.select({ n: count() }).from(batches).where(and(eq(batches.siteId, siteId), eq(batches.status, "awaiting_qc")));
  return Number(lots?.n ?? 0) + Number(bs?.n ?? 0);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  // ADR-080 §11, ADR-081: five destinations; the menu and the phone/iPad-portrait tab bar follow the role.
  const approvalCount = await myApprovalCount(ctx).catch(() => 0); // ADR-075 "To approve" badge
  const approver = isApprover((p) => ctx.can(p), ctx.roleCodes, ctx.permissions, approvalCount); // ADR-082: hidden from people who never approve
  const nav = buildNav((p) => ctx.can(p), ctx.roleCodes, { approver });
  const tabs = tabsFor((p) => ctx.can(p), ctx.roleCodes);
  const qaCount = ctx.can("quality.disposition.view") ? await openQaCount(ctx.currentSiteId) : null;
  const unreadCount = await unreadNotificationCount(ctx);
  const maintenance = await getMaintenanceState(db, ctx.organizationId);
  return (
    <Shell
      nav={nav}
      tabs={tabs}
      user={{ id: ctx.userId, name: ctx.displayName, roles: ctx.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r).join(", ") }}
      sites={ctx.allowedSites}
      currentSiteId={ctx.currentSiteId}
      qaCount={qaCount}
      unreadCount={unreadCount}
      approvalCount={approvalCount}
      showApprovals={approver}
      switchSite={switchSite}
      signOut={signOut}
      demo={isDemoMode() ? { canReset: ctx.roleCodes.includes("owner_director"), sandbox: isSandboxEmail(ctx.email) } : null}
    >
      {maintenance.enabled && <MaintenanceBanner canWrite={!ctx.readOnly} />}
      {children}
    </Shell>
  );
}
