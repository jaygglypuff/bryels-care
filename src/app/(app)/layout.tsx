import { requireContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { NAV } from "./nav";
import { Shell } from "./shell";
import { signOut, switchSite } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.planned || !i.permission || ctx.can(i.permission)) })).filter((g) => g.items.length > 0);
  return (
    <Shell
      nav={nav}
      user={{ name: ctx.displayName, roles: ctx.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r).join(", ") }}
      sites={ctx.allowedSites}
      currentSiteId={ctx.currentSiteId}
      switchSite={switchSite}
      signOut={signOut}
    >
      {children}
    </Shell>
  );
}
