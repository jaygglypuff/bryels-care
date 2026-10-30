"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, Boxes, CalendarDays, ChevronDown, ClipboardList, Clock, Database, Factory, FlaskConical, GitBranch, HelpCircle, Home, ListChecks, Menu, PackagePlus, ScanLine,
  ScrollText, Settings, ShieldCheck, ShoppingCart, Truck, Warehouse, Wrench, X,
} from "lucide-react";
import { groupHref, groupSections, type NavBadges, type NavGroup, type NavItem, type Tab } from "./nav";
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
  truck: <Truck size={20} />, approve: <ListChecks size={20} />, shield: <ShieldCheck size={20} />, boxes: <Boxes size={20} />, receive: <PackagePlus size={20} />,
  menu: <Menu size={20} />,
};

type Props = {
  nav: NavGroup[];
  /** Bottom tab bar per role (ADR-081; built by tabsFor in nav.ts). */
  tabs: Tab[];
  user: { id: string; name: string; roles: string };
  sites: { id: string; code: string; name: string }[];
  currentSiteId: string;
  /** Open QA queue items at the current site (QA users only): badge on the QA rail icon, phone tab and QA queue tab. */
  qaCount: number | null;
  /** Open, unread in-app notifications of the signed-in user (US-2-03). */
  unreadCount: number;
  /** ADR-075: approvals waiting for the signed-in user (the "To approve" badge). */
  approvalCount?: number;
  /** ADR-082: show the "To approve" button only to people who approve something. */
  showApprovals?: boolean;
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

export function Shell({ nav, tabs, user, sites, currentSiteId, qaCount, unreadCount, approvalCount = 0, showApprovals = true, switchSite, signOut, demo = null, children }: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);

  const real = nav;
  // Most specific match wins for both the module pill and the sub-tab.
  let activeGroup: NavGroup | undefined;
  let activeHref = "";
  let best = -1;
  for (const g of real) for (const i of g.items) {
    const m = matchLen(pathname, i.href);
    if (m > best) { best = m; activeGroup = g; activeHref = i.href; }
  }
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const site = sites.find((s) => s.id === currentSiteId);
  const badges: NavBadges = { ...(qaCount ? { "/quality/check": qaCount, "/quality": qaCount } : {}), ...(approvalCount ? { "/approvals": approvalCount } : {}) };
  // Only the closest tab lights up (/inventory/receive must not also light up /inventory).
  const activeTab = tabs.reduce<{ href: string | null; m: number }>((best, t) => {
    const m = t.href ? matchLen(pathname, t.href) : -1;
    return m > best.m ? { href: t.href, m } : best;
  }, { href: null, m: -1 }).href;
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
    <div className="min-h-dvh pb-[76px] xl:pb-0">
      <NavigationProgress />
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
        {demo && <DemoBanner canReset={demo.canReset} sandbox={demo.sandbox} />}
        <div className="mx-auto flex h-[68px] max-w-[1480px] items-center gap-3 px-4 sm:px-6">
          <button className="grid size-11 shrink-0 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)] xl:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <Link href="/dashboard" className="shrink-0" aria-label="Bryel's Care home">
            <LogoMark className="size-9 sm:hidden" />
            <Logo className="hidden h-9 w-auto sm:block" />
          </Link>
          <nav aria-label="Modules" className="mx-auto hidden min-w-0 xl:block">
            <ul className="scroll-x-hidden flex items-center gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-[var(--shadow-card)]">
              {real.map((g) => {
                const active = g === activeGroup;
                return (
                  <li key={g.label}>
                    <Link
                      href={groupHref(g)}
                      aria-current={active ? "page" : undefined}
                      title={g.description}
                      className={cx(
                        "flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-colors",
                        active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {ICONS[g.icon]}
                      <span className="flex flex-col leading-tight">
                        <span>{g.label}</span>
                        <span className={cx("hidden text-[11px] font-normal 2xl:block", active ? "text-white/75" : "text-muted")}>{g.description}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-0">
            {sites.length > 1 && <div className="hidden xl:block">{siteSwitcher}</div>}
            <Link href="/inventory/scan" className="hidden h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-2.5 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg sm:flex" aria-label="Scan or search" title="Scan or search">
              <ScanLine size={18} />
              <span className="hidden md:inline xl:hidden 2xl:inline">Scan or search</span>
            </Link>
            <div className="hidden sm:block">
              <SyncChip userId={user.id} />
            </div>
            {/* ADR-075: "To approve" is one tap away for people who approve (ADR-082). */}
            {showApprovals && (
            <Link
              href="/approvals"
              className={cx("relative flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg", pathname.startsWith("/approvals") && "text-primary-text")}
              aria-label={`To approve, ${approvalCount} waiting`}
              title="To approve"
            >
              <ListChecks size={18} />
              <span className="hidden md:inline xl:hidden 2xl:inline whitespace-nowrap">To approve</span>
              {approvalCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{approvalCount > 99 ? "99+" : approvalCount}</span>
              )}
            </Link>
            )}
            <Link href="/notifications" className="relative flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-2.5 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg" aria-label={`Messages, ${unreadCount} unread`} title="Messages">
              <Bell size={18} />
              <span className="hidden md:inline xl:hidden 2xl:inline">Messages</span>
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </Link>
            <details className="relative shrink-0">
              <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-lime-100 text-[13px] font-semibold text-brand ring-2 ring-white" style={{ background: "var(--lime-200)", color: "var(--brand-800)" }} aria-label="Account">
                {initials}
              </summary>
              <div className="absolute right-0 top-12 z-40 w-64 max-w-[calc(100vw-32px)] rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
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
        {/* Tabs of the active destination; each named section is one small menu ("Advanced" last), ADR-081. */}
        {activeGroup && (() => {
          const { main, sections } = groupSections(activeGroup);
          if (main.length + sections.length <= 1) return null;
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
            <div className="mx-auto hidden max-w-[1480px] px-4 pb-3 sm:px-6 xl:block">
              <ul className="flex flex-wrap items-center gap-1.5">
                {main.map(pill)}
                {sections.map((sec) => {
                  const here = sec.items.some((i) => i.href === activeHref);
                  return (
                    <li key={sec.name}>
                      {/* keyed by path so an open menu closes after navigating */}
                      <details className="relative" key={pathname}>
                        <summary className={cx("flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium", here ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2 hover:text-fg")}>
                          {sec.name}
                          <ChevronDown size={14} aria-hidden />
                        </summary>
                        <ul className="absolute left-0 top-9 z-40 w-64 rounded-[16px] border border-line bg-surface p-2 shadow-[var(--shadow-pop)]">
                          {sec.items.map((i) => (
                            <li key={i.label}>
                              {i.planned ? (
                                <span className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[13px] text-muted" aria-disabled="true">
                                  {i.label}
                                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase">{i.planned}</span>
                                </span>
                              ) : (
                                <Link href={i.href} aria-current={i.href === activeHref ? "page" : undefined} className={cx("flex items-center justify-between rounded-[10px] px-3 py-2 text-[13px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
                                  {i.label}
                                  <CountBadge n={badges[i.href]} />
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}
        {/* Phones and tablets (below 1280 px): the destination's main tabs in one swipeable row; sections live in the menu. */}
        {activeGroup && (() => {
          const { main, sections } = groupSections(activeGroup);
          if (main.length <= 1 && sections.length === 0) return null;
          return (
            <nav aria-label={`${activeGroup.label} pages`} className="xl:hidden">
              <ul className="scroll-x-hidden mx-auto flex max-w-[1480px] gap-1.5 overflow-x-auto px-4 pb-2.5 sm:px-6">
                {main.map((i) => (
                  <li key={i.href} className="shrink-0">
                    <Link
                      href={i.href}
                      aria-current={i.href === activeHref ? "page" : undefined}
                      className={cx("flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium", i.href === activeHref ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2")}
                    >
                      {i.label}
                      <CountBadge n={badges[i.href]} />
                    </Link>
                  </li>
                ))}
                {sections.length > 0 && (
                  <li className="shrink-0">
                    <button type="button" onClick={() => setDrawer(true)} className={cx("flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium", sections.some((x) => x.items.some((i) => i.href === activeHref)) ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2")}>
                      More <ChevronDown size={14} aria-hidden />
                    </button>
                  </li>
                )}
              </ul>
            </nav>
          );
        })()}
      </header>

      <div className="mx-auto flex max-w-[1480px] gap-6 px-4 sm:px-6">
        <main className="min-w-0 flex-1 py-5 sm:py-7">
          <DeletedNotice pathname={pathname} />
          {children}
        </main>
      </div>

      {/* Phone bottom tab bar */}
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden">
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
            const active = t.href === activeTab;
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
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col overflow-y-auto bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Logo className="h-8 w-auto" />
              <button className="grid size-9 place-items-center rounded-full bg-surface-2" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            {sites.length > 1 && <div className="mb-4">{siteSwitcher}</div>}
            <div className="mb-4 sm:hidden">
              <SyncChip userId={user.id} />
            </div>
            {real.map((g) => {
              const { main, sections } = groupSections(g);
              const row = (i: NavItem) =>
                i.planned ? (
                  <li key={i.label}>
                    <span className="flex min-h-[44px] items-center justify-between px-3 py-2 text-[13px] text-muted" aria-disabled="true">
                      {i.label}
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase">{i.planned}</span>
                    </span>
                  </li>
                ) : (
                  <li key={i.href}>
                    <Link href={i.href} aria-label={badges[i.href] ? withCount(i.label, i.href) : undefined} className={cx("flex min-h-[44px] items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-[14px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
                      {i.label}
                      <CountBadge n={badges[i.href]} />
                    </Link>
                  </li>
                );
              return (
                <details key={g.label} className="mb-1 border-b border-line pb-1" open={g === activeGroup}>
                  <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2.5 px-2 text-[16px] font-semibold text-fg">
                    {ICONS[g.icon]}
                    <span className="flex flex-1 flex-col leading-tight">
                      {g.label}
                      <span className="text-[12px] font-normal text-muted">{g.description}</span>
                    </span>
                    <ChevronDown size={18} className="text-muted" aria-hidden />
                  </summary>
                  <ul>{main.map(row)}</ul>
                  {sections.map((sec) => (
                    <details key={sec.name} className="mt-0.5" open={sec.items.some((i) => i.href === activeHref)}>
                      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-[14px] font-medium text-fg-2">{sec.name}<ChevronDown size={16} aria-hidden /></summary>
                      <ul className="pl-2">{sec.items.map(row)}</ul>
                    </details>
                  ))}
                </details>
              );
            })}
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
