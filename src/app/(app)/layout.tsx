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
import { NAV, QUICK_ACTIONS } from "./nav";
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
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.planned || !i.permission || ctx.can(i.permission)) })).filter((g) => g.items.length > 0);
  const quickActions = QUICK_ACTIONS.filter((q) => !q.permission || ctx.can(q.permission));
  const qaCount = ctx.can("quality.disposition.view") ? await openQaCount(ctx.currentSiteId) : null;
  const unreadCount = await unreadNotificationCount(ctx);
  const approvalCount = await myApprovalCount(ctx).catch(() => 0); // ADR-075 "To approve" badge
  const maintenance = await getMaintenanceState(db, ctx.organizationId);
  return (
    <Shell
      nav={nav}
      quickActions={quickActions}
      user={{ id: ctx.userId, name: ctx.displayName, roles: ctx.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r).join(", ") }}
      sites={ctx.allowedSites}
      currentSiteId={ctx.currentSiteId}
      qaCount={qaCount}
      unreadCount={unreadCount}
      approvalCount={approvalCount}
      switchSite={switchSite}
      signOut={signOut}
      demo={isDemoMode() ? { canReset: ctx.roleCodes.includes("owner_director"), sandbox: isSandboxEmail(ctx.email) } : null}
    >
      {maintenance.enabled && <MaintenanceBanner canWrite={!ctx.readOnly} />}
      {children}
    </Shell>
  );
}
