"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, Boxes, CalendarDays, ClipboardList, Clock, Database, Factory, FlaskConical, GitBranch, HelpCircle, Home, ListChecks, Menu, PackagePlus, ScanLine,
  ScrollText, Settings, ShieldCheck, ShoppingCart, Truck, Warehouse, Wrench, X,
} from "lucide-react";
import type { NavBadges, NavGroup, NavItem, QuickAction, Tab } from "./nav";
import { cx } from "@/ui/core";
import { Logo, LogoMark } from "@/ui/brand";
import { NavigationProgress } from "@/ui/navigation-progress";
import { DemoBanner } from "@/ui/demo-banner";
import { SignOutButton, SyncChip } from "@/ui/sync-status";

const ICONS: Record<string, React.ReactNode> = {
  home: <Home size={18} />, boxes: <Boxes size={18} />, factory: <Factory size={18} />, shield: <ShieldCheck size={18} />,
  truck: <Truck size={18} />, warehouse: <Warehouse size={18} />, wrench: <Wrench size={18} />, database: <Database size={18} />, settings: <Settings size={18} />, clock: <Clock size={18} />,
  scan: <ScanLine size={19} />, receive: <PackagePlus size={19} />, batch: <FlaskConical size={19} />, qa: <ClipboardList size={19} />,
  order: <ShoppingCart size={19} />, trace: <GitBranch size={19} />, audit: <ScrollText size={19} />, approve: <ListChecks size={19} />,
};

const TAB_ICONS: Record<Tab["icon"], React.ReactNode> = {
  home: <Home size={20} />, today: <CalendarDays size={20} />, scan: <ScanLine size={20} />, help: <HelpCircle size={20} />, factory: <Factory size={20} />,
  truck: <Truck size={20} />, approve: <ListChecks size={20} />, shield: <ShieldCheck size={20} />, menu: <Menu size={20} />,
};

/** Items of a group without a section, under "Setup", and in the collapsed "Advanced" part (ADR-080 §11). */
function sections(items: NavItem[]) {
  const live = items.filter((i) => !i.planned);
  return { main: live.filter((i) => !i.section), setup: live.filter((i) => i.section === "setup"), advanced: live.filter((i) => i.section === "advanced") };
}

type Props = {
  nav: NavGroup[];
  /** Bottom tab bar per role (ADR-080 §11; built by tabsFor in nav.ts). */
  tabs: Tab[];
  quickActions: QuickAction[];
  user: { id: string; name: string; roles: string };
  sites: { id: string; code: string; name: string }[];
  currentSiteId: string;
  /** Open QA queue items at the current site (QA users only): badge on the QA rail icon, phone tab and QA queue tab. */
  qaCount: number | null;
  /** Open, unread in-app notifications of the signed-in user (US-2-03). */
  unreadCount: number;
  /** ADR-075: approvals waiting for the signed-in user (the "To approve" badge). */
  approvalCount?: number;
  switchSite: (fd: FormData) => Promise<void>;
  signOut: () => Promise<void>;
  /** Demo mode (ADR-055): the strip above the top bar; `canReset` adds the owner's reset link. Null outside the demo. */
  demo?: { canReset: boolean; sandbox?: boolean } | null;
  children: React.ReactNode;
};

/** "Draft deleted." after a delete redirected here with ?deleted=1 (ADR-075); read from the URL after navigation. */
function DeletedNotice({ pathname }: { pathname: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(new URLSearchParams(window.location.search).get("deleted") === "1"), [pathname]);
  if (!show) return null;
  return (
    <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-[14px]">
      <span>Draft deleted. A copy is kept in the audit log.</span>
      <button type="button" onClick={() => setShow(false)} className="min-h-[44px] px-2 text-primary-text" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}

/** Small count badge (QA queue); hidden at zero. */
function CountBadge({ n, className }: { n: number | undefined; className?: string }) {
  if (!n) return null;
  return (
    <span className={cx("grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white", className)} aria-hidden="true">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function matchLen(pathname: string, href: string) {
  if (href === "#") return -1;
  if (pathname === href) return href.length + 1000;
  if (pathname.startsWith(href + "/")) return href.length;
  return -1;
}

export function Shell({ nav, tabs, quickActions, user, sites, currentSiteId, qaCount, unreadCount, approvalCount = 0, switchSite, signOut, demo = null, children }: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);

  const real = nav.filter((g) => g.items.some((i) => !i.planned));
  const planned = nav.flatMap((g) => g.items.filter((i) => i.planned));
  // Most specific match wins for both the module pill and the sub-tab.
  let activeGroup: NavGroup | undefined;
  let activeHref = "";
  let best = -1;
  for (const g of real) for (const i of g.items) {
    const m = matchLen(pathname, i.href);
    if (m > best) { best = m; activeGroup = g; activeHref = i.href; }
  }
  const groupHref = (g: NavGroup) => g.items.find((i) => !i.planned)?.href ?? "#";
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const site = sites.find((s) => s.id === currentSiteId);
  const badges: NavBadges = { ...(qaCount ? { "/quality": qaCount } : {}), ...(approvalCount ? { "/approvals": approvalCount } : {}) };
  const withCount = (label: string, href: string) => (badges[href] ? `${label}, ${badges[href]} open` : label);

  const siteSwitcher = (
    <form action={switchSite} className="flex items-center">
      <input type="hidden" name="returnTo" value={pathname} />
      <label htmlFor="site-switch" className="sr-only">Site</label>
      <select
        id="site-switch"
        name="siteId"
        defaultValue={currentSiteId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-10 max-w-[180px] cursor-pointer rounded-full border border-line bg-surface pl-3 pr-8 text-[13px] font-medium text-fg shadow-[var(--shadow-card)]"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
        ))}
      </select>
    </form>
  );

  return (
    <div className="min-h-dvh pb-[76px] lg:pb-0">
      <NavigationProgress />
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
        {demo && <DemoBanner canReset={demo.canReset} sandbox={demo.sandbox} />}
        <div className="mx-auto flex h-[68px] max-w-[1480px] items-center gap-3 px-4 sm:px-6">
          <button className="grid size-10 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)] lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <Link href="/dashboard" className="shrink-0" aria-label="Bryel's Care home">
            <Logo className="h-9 w-auto" />
          </Link>
          <nav aria-label="Modules" className="mx-auto hidden min-w-0 lg:block">
            <ul className="scroll-x-hidden flex items-center gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-[var(--shadow-card)]">
              {real.map((g) => {
                const active = g === activeGroup;
                return (
                  <li key={g.label}>
                    <Link
                      href={groupHref(g)}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-colors",
                        active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {g.label === "Home" ? "Overview" : g.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            {sites.length > 1 && <div className="hidden sm:block">{siteSwitcher}</div>}
            <Link href="/inventory/scan" className="hidden size-10 place-items-center rounded-full bg-surface text-fg-2 shadow-[var(--shadow-card)] hover:text-fg sm:grid" aria-label="Scan or search" title="Scan or search">
              <ScanLine size={18} />
            </Link>
            <SyncChip userId={user.id} />
            {/* ADR-075: "To approve" is always one tap away, with the number waiting for this user. */}
            <Link
              href="/approvals"
              className={cx("relative flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg", pathname.startsWith("/approvals") && "text-primary-text")}
              aria-label={`To approve, ${approvalCount} waiting`}
              title="To approve"
            >
              <ListChecks size={18} />
              <span className="hidden md:inline">To approve</span>
              {approvalCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{approvalCount > 99 ? "99+" : approvalCount}</span>
              )}
            </Link>
            <Link href="/notifications" className="relative grid size-10 place-items-center rounded-full bg-surface text-fg-2 shadow-[var(--shadow-card)] hover:text-fg" aria-label={`Notifications, ${unreadCount} unread`} title="Notifications">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </Link>
            <details className="relative">
              <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-lime-100 text-[13px] font-semibold text-brand ring-2 ring-white" style={{ background: "var(--lime-200)", color: "var(--brand-800)" }} aria-label="Account">
                {initials}
              </summary>
              <div className="absolute right-0 top-12 z-40 w-64 rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
                <p className="font-semibold text-fg">{user.name}</p>
                <p className="text-[12px] text-muted">{user.roles}</p>
                <p className="mt-2 text-[12px] text-muted">Site: {site?.code} · {site?.name}</p>
                <Link href="/account" className="mt-3 block text-[13px] font-medium text-primary-text hover:underline">My account and devices</Link>
                {demo?.canReset && <Link href="/admin/demo" className="mt-2 block text-[13px] font-medium text-primary-text hover:underline">Reset demo data</Link>}
                <div className="mt-3 border-t border-line pt-3">
                  <SignOutButton signOut={signOut} variant="menu" />
                </div>
              </div>
            </details>
          </div>
        </div>
        {/* Sub-page tabs for the active module; Setup items follow, Advanced items sit in a collapsed menu (ADR-080 §11). */}
        {activeGroup && activeGroup.items.filter((i) => !i.planned).length > 1 && (() => {
          const sec = sections(activeGroup.items);
          const pill = (i: NavItem) => (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={i.href === activeHref ? "page" : undefined}
                aria-label={badges[i.href] ? withCount(i.label, i.href) : undefined}
                className={cx(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  i.href === activeHref ? "border-transparent bg-brand text-white" : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
                )}
                style={i.href === activeHref ? { background: "var(--brand-600)" } : undefined}
              >
                {i.label}
                <CountBadge n={badges[i.href]} />
              </Link>
            </li>
          );
          return (
            <div className="mx-auto hidden max-w-[1480px] px-4 pb-3 sm:px-6 lg:block lg:pl-[92px]">
              <ul className="flex flex-wrap items-center gap-1.5">
                {sec.main.map(pill)}
                {sec.setup.length > 0 && <li className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Setup</li>}
                {sec.setup.map(pill)}
                {sec.advanced.length > 0 && (
                  <li>
                    <details className="relative">
                      <summary className={cx("flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium", sec.advanced.some((i) => i.href === activeHref) ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2 hover:text-fg")}>
                        Advanced
                      </summary>
                      <ul className="absolute left-0 top-9 z-40 w-64 rounded-[16px] border border-line bg-surface p-2 shadow-[var(--shadow-pop)]">
                        {sec.advanced.map((i) => (
                          <li key={i.href}>
                            <Link href={i.href} aria-current={i.href === activeHref ? "page" : undefined} className={cx("block rounded-[10px] px-3 py-2 text-[13px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
                              {i.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                )}
              </ul>
            </div>
          );
        })()}
      </header>

      <div className="mx-auto flex max-w-[1480px] gap-6 px-4 sm:px-6">
        {/* Quick-action rail */}
        <aside className="no-print sticky top-[124px] hidden h-fit flex-col items-center gap-2 py-6 lg:flex" aria-label="Quick actions">
          <div className="flex flex-col gap-2 rounded-full bg-surface p-1.5 shadow-[var(--shadow-card)]">
            {quickActions.map((q) => {
              const active = matchLen(pathname, q.href) >= 0;
              return (
                <Link
                  key={q.href}
                  href={q.href}
                  title={withCount(q.label, q.href)}
                  aria-label={withCount(q.label, q.href)}
                  className={cx("relative grid size-11 place-items-center rounded-full transition-colors", active ? "text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}
                  style={active ? { background: "var(--brand-600)" } : undefined}
                >
                  {ICONS[q.icon]}
                  <CountBadge n={badges[q.href]} className="absolute -right-1 -top-1" />
                </Link>
              );
            })}
          </div>
          <SignOutButton signOut={signOut} variant="rail" />
        </aside>
        <main className="min-w-0 flex-1 py-5 sm:py-7">
          <DeletedNotice pathname={pathname} />
          {children}
        </main>
      </div>

      {/* Phone bottom tab bar */}
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="mx-auto flex max-w-[560px] justify-around">
          {tabs.map((t) => {
            const inner = (active: boolean) => (
              <>
                <span className={cx("relative grid h-7 w-12 place-items-center rounded-full", active && "bg-[var(--lime-100)]")}>
                  {TAB_ICONS[t.icon]}
                  {t.href && <CountBadge n={badges[t.href]} className="absolute -right-0.5 -top-1" />}
                </span>
                {t.label}
              </>
            );
            if (!t.href)
              return (
                <li key="menu" className="flex-1">
                  <button type="button" onClick={() => setDrawer(true)} className="flex min-h-[56px] w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted" aria-label="Open menu">
                    {inner(false)}
                  </button>
                </li>
              );
            const active = matchLen(pathname, t.href) >= 0;
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} aria-label={badges[t.href] ? withCount(t.label, t.href) : undefined} className={cx("flex min-h-[56px] flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-primary-text" : "text-muted")}>
                  {inner(active)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Drawer (tablet and phone) */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col overflow-y-auto bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Logo className="h-8 w-auto" />
              <button className="grid size-9 place-items-center rounded-full bg-surface-2" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            {sites.length > 1 && <div className="mb-4 sm:hidden">{siteSwitcher}</div>}
            {real.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{ICONS[g.icon]} {g.label}</p>
                {(() => {
                  const sec = sections(g.items);
                  const row = (i: NavItem) => (
                    <li key={i.href}>
                      <Link href={i.href} aria-label={badges[i.href] ? withCount(i.label, i.href) : undefined} className={cx("flex min-h-[44px] items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-[14px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
                        {i.label}
                        <CountBadge n={badges[i.href]} />
                      </Link>
                    </li>
                  );
                  return (
                    <>
                      <ul>{sec.main.map(row)}</ul>
                      {sec.setup.length > 0 && (
                        <>
                          <p className="mt-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Setup</p>
                          <ul>{sec.setup.map(row)}</ul>
                        </>
                      )}
                      {sec.advanced.length > 0 && (
                        <details className="mt-1" open={sec.advanced.some((i) => i.href === activeHref)}>
                          <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-medium text-muted">Advanced</summary>
                          <ul>{sec.advanced.map(row)}</ul>
                        </details>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
            {planned.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Coming next</p>
                {planned.map((i) => (
                  <p key={i.label} className="flex items-center justify-between px-3 py-2 text-[13px] text-muted" aria-disabled="true">
                    {i.label}<span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase">{i.planned}</span>
                  </p>
                ))}
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
              <LogoMark className="size-8" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{user.name}</p>
                <p className="truncate text-[12px] text-muted">{user.roles}</p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
