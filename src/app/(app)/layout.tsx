import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { unreadNotificationCount } from "@/modules/platform";
import { myApprovalCount } from "@/modules/action-centre";
import { qaQueueCount } from "@/modules/quality";
import { screenPreferences } from "@/modules/governance";
import { getMaintenanceState } from "@/lib/maintenance";
import { MaintenanceBanner } from "@/ui/maintenance-banner";
import { isDemoMode, isSandboxEmail } from "@/lib/demo";
import { AREAS_BY_PERSONA, buildNav, homeHref, isApprover, isFloor, navPersona, setupSections, tabsFor } from "./nav";
import { Shell } from "./shell";
import { helpForScreen, signOut, switchSite } from "./actions";
import { masterSearchAction } from "./search-actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p);
  // Round 5 (ADR-129): one menu per job (nav.ts); the bottom bar follows the role.
  const approvalCount = await myApprovalCount(ctx).catch(() => 0); // ADR-075 "To approve" badge
  const approver = isApprover(can, ctx.roleCodes, ctx.permissions, approvalCount); // ADR-082: hidden from people who never approve
  const persona = navPersona(can, ctx.roleCodes);
  const nav = buildNav(can, ctx.roleCodes, { approver });
  const tabs = tabsFor(can, ctx.roleCodes);
  const qaCount = ctx.can("quality.disposition.view") ? (await qaQueueCount(ctx.organizationId, ctx.currentSiteId)).total : null; // same rule as the QA list (UX audit)
  // Messages that are done are cleared first (round 5: "messages clear when the work is done").
  const unreadCount = await unreadNotificationCount(ctx);
  const maintenance = await getMaintenanceState(db, ctx.organizationId);
  // ADR-126: the screen settings (top bar: search or Scan; search open to everyone or stock people only).
  const prefs = await screenPreferences(ctx);
  return (
    <Shell
      nav={nav}
      tabs={tabs}
      homeHref={homeHref(ctx.roleCodes)}
      floor={isFloor(persona)}
      needsMeArea={AREAS_BY_PERSONA[persona].some((a) => a.label === "Needs me") && nav.some((g) => g.label === "Needs me")}
      hasSetup={setupSections(can, ctx.roleCodes).length > 0}
      user={{ id: ctx.userId, name: ctx.displayName, roles: ctx.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r).join(", ") }}
      sites={ctx.allowedSites}
      currentSiteId={ctx.currentSiteId}
      qaCount={qaCount}
      unreadCount={unreadCount}
      approvalCount={approvalCount}
      showApprovals={approver}
      switchSite={switchSite}
      loadHelp={helpForScreen}
      search={prefs.canSearch ? masterSearchAction : undefined}
      wideTopBar={prefs.wideTopBar}
      showScan={prefs.canSearch}
      signOut={signOut}
      demo={isDemoMode() ? { canReset: ctx.roleCodes.includes("owner_director"), sandbox: isSandboxEmail(ctx.email) } : null}
    >
      {maintenance.enabled && <MaintenanceBanner canWrite={!ctx.readOnly} />}
      {children}
    </Shell>
  );
}
