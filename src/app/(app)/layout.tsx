import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { unreadNotificationCount } from "@/modules/platform";
import { qaQueueCount } from "@/modules/quality";
import { screenPreferences } from "@/modules/governance";
import { getMaintenanceState } from "@/lib/maintenance";
import { MaintenanceBanner } from "@/ui/maintenance-banner";
import { NumberEntryProvider } from "@/ui/keypad";
import { isDemoMode, isSandboxEmail } from "@/lib/demo";
import { AREAS_BY_PERSONA, buildNav, homeHref, isApprover, isFloor, navPersona, setupSections, tabsFor } from "./nav";
import { Shell } from "./shell";
import { needsMeFor } from "./needs-me";
import { helpForScreen, signOut, switchSite } from "./actions";
import { masterSearchAction } from "./search-actions";

export const dynamic = "force-dynamic";

const SIDEBAR_SCRIPT = `try{if(localStorage.getItem("bc.sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p);
  // Round 5 (ADR-129): one menu per job (nav.ts); the bottom bar follows the role.
  // ADR-132 §1: one "Needs me" number (approvals + checks + messages asking to act); its approvals are the ADR-075 badge.
  const needsMe = await needsMeFor(ctx);
  const approvalCount = needsMe.approvals;
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
  const setup = setupSections(can, ctx.roleCodes);
  return (
    <>
    {/* ADR-136: the collapsed sidebar (icons only) is remembered on the device; set before paint so nothing jumps. */}
    <script dangerouslySetInnerHTML={{ __html: SIDEBAR_SCRIPT }} />
    <Shell
      nav={nav}
      tabs={tabs}
      homeHref={homeHref(ctx.roleCodes)}
      floor={isFloor(persona)}
      needsMeArea={AREAS_BY_PERSONA[persona].some((a) => a.label === "Needs me") && nav.some((g) => g.label === "Needs me")}
      hasSetup={setup.length > 0}
      hasSettings={setup.some((x) => x.items.some((i) => i.href === "/admin/settings"))}
      user={{ id: ctx.userId, name: ctx.displayName, roles: ctx.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r).join(", ") }}
      sites={ctx.allowedSites}
      currentSiteId={ctx.currentSiteId}
      qaCount={qaCount}
      unreadCount={unreadCount}
      approvalCount={approvalCount}
      needsMeCount={needsMe.total}
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
      {/* ADR-135: how numbers are typed on Weigh and Step (ui.number_entry); a person's own choice on the device wins. */}
      <NumberEntryProvider value={prefs.numberEntry}>{children}</NumberEntryProvider>
    </Shell>
    </>
  );
}
