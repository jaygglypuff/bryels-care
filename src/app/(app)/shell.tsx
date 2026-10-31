"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell, Boxes, CalendarDays, ChevronDown, ClipboardList, Clock, Cloud, CloudOff, CloudUpload, Database, Factory, FlaskConical, GitBranch, GitMerge, HelpCircle, Home, ListChecks, Menu,
  PackagePlus, ScanLine, ScrollText, Settings, ShieldCheck, ShoppingCart, Truck, Warehouse, Wrench, X,
} from "lucide-react";
import { groupHref, groupSections, type NavBadges, type NavGroup, type NavItem, type Tab } from "./nav";
import { cx } from "@/ui/core";
import { Logo, LogoMark } from "@/ui/brand";
import { NavigationProgress } from "@/ui/navigation-progress";
import { DemoBanner } from "@/ui/demo-banner";
import { SignOutButton, SyncChip, useSync } from "@/ui/sync-status";
import type { SyncState } from "@/lib/offline/agent";

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
  /** Open QA queue items at the current site (QA users only): badge on the QA tab and the QA entries. */
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
      <button type="button" onClick={() => setShow(false)} className="grid min-h-[44px] min-w-[44px] place-items-center px-2 text-primary-text" aria-label="Dismiss">
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

/** UX audit R2: the tab rows leave out screens the top bar already shows ("one door per job"). */
const inTabRow = (i: NavItem) => i.topBar !== "always";
/** "wide" entries are top-bar buttons from 640 px, so the row shows them on phones only. */
const rowItemClass = (i: NavItem) => (i.topBar === "wide" ? "sm:hidden" : undefined);

/** A section's everyday entries, then its rarely used ones folded under "Advanced" (UX audit R2). */
function splitAdvanced(items: NavItem[]) {
  return { daily: items.filter((i) => !i.advanced), advanced: items.filter((i) => i.advanced) };
}

const plural = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

/** The drawer's sync line in words (never an empty pill): "All saved", "3 changes waiting to send", … */
export function syncWords(s: SyncState): { text: string; tone: "ok" | "info" | "warn" | "bad" } {
  const pending = s.stats.pending + s.stats.syncing;
  if (!s.supported) return { text: "This browser cannot keep work without signal", tone: "warn" };
  if (s.stats.conflict) return { text: `${plural(s.stats.conflict)} to check`, tone: "bad" };
  if (s.stats.failed) return { text: `${plural(s.stats.failed)} could not be sent`, tone: "bad" };
  if (s.needsSignIn && pending) return { text: `Sign in again to send ${plural(pending)}`, tone: "warn" };
  if (!s.online) return { text: pending ? `No signal · ${plural(pending)} waiting to send` : "No signal · nothing waiting to send", tone: "warn" };
  if (pending) return { text: `${plural(pending)} waiting to send`, tone: "info" };
  return { text: "All saved", tone: "ok" };
}

const SYNC_TONE: Record<string, string> = {
  ok: "border-line bg-surface-2 text-fg-2",
  info: "border-[var(--info-bd)] bg-[var(--info-bg)] text-[var(--info-fg)]",
  warn: "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]",
  bad: "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]",
};

function DrawerSync({ userId }: { userId: string }) {
  const s = useSync(userId);
  const w = syncWords(s);
  const icon = w.tone === "ok" ? <Cloud size={18} aria-hidden /> : w.tone === "bad" ? (s.stats.conflict ? <GitMerge size={18} aria-hidden /> : <CloudOff size={18} aria-hidden />) : s.online ? <CloudUpload size={18} aria-hidden /> : <CloudOff size={18} aria-hidden />;
  return (
    <Link href="/sync" className={cx("flex min-h-[44px] items-center gap-2 rounded-[12px] border px-3 text-[14px] font-medium", SYNC_TONE[w.tone])} data-testid="drawer-sync">
      {icon}
      <span>{w.text}</span>
    </Link>
  );
}

export function Shell({ nav, tabs, user, sites, currentSiteId, qaCount, unreadCount, approvalCount = 0, showApprovals = true, switchSite, signOut, demo = null, children }: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);

  // Phone/tablet tab row: a fade at the right edge while more tabs are hidden, and the open tab scrolled into view.
  const rowRef = useRef<HTMLUListElement>(null);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    // Bring the open tab into view inside the row only (never scrolls the page).
    const cur = el.querySelector<HTMLElement>("[aria-current=page]");
    if (cur) {
      const r = cur.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      if (r.right > box.right - 48) el.scrollLeft += r.right - box.right + 48;
      else if (r.left < box.left) el.scrollLeft -= box.left - r.left;
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

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
        className="h-11 max-w-[150px] cursor-pointer rounded-full border border-line bg-surface pl-3 pr-8 text-[13px] font-medium text-fg shadow-[var(--shadow-card)]"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
        ))}
      </select>
    </form>
  );

  /** One entry of a section's dropdown (desktop). */
  const dropItem = (i: NavItem) => (
    <li key={i.href}>
      {i.planned ? (
        <span className="flex min-h-[44px] items-center justify-between rounded-[10px] px-3 py-2 text-[13px] text-muted" aria-disabled="true">
          {i.label}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase">{i.planned}</span>
        </span>
      ) : (
        <Link href={i.href} aria-current={i.href === activeHref ? "page" : undefined} className={cx("flex min-h-[44px] items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[13px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
          {i.label}
          <CountBadge n={badges[i.href]} />
        </Link>
      )}
    </li>
  );

  return (
    <div className="min-h-dvh pb-[76px] xl:pb-0">
      <NavigationProgress />
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
        {demo && <DemoBanner canReset={demo.canReset} sandbox={demo.sandbox} />}
        <div className="mx-auto flex h-[68px] max-w-[1480px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <button className="grid size-11 shrink-0 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)] xl:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <Link href="/dashboard" className="grid min-h-11 min-w-11 shrink-0 place-items-center" aria-label="Bryel's Care home">
            <LogoMark className="size-9 sm:hidden" />
            <Logo className="hidden h-9 w-auto sm:block" />
          </Link>
          {/* Destinations. The five never fit with their one-line descriptions inside the 1480 px frame (measured: 1063 px
              needed, about 530 free), so each description is a tooltip and the open one leads the tab row below (UX audit R2). */}
          <nav aria-label="Modules" className="hidden min-w-0 flex-1 xl:block">
            <ul className="scroll-x-hidden mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-[var(--shadow-card)]">
              {real.map((g) => {
                const active = g === activeGroup;
                return (
                  <li key={g.label}>
                    <Link
                      href={groupHref(g)}
                      aria-current={active ? "page" : undefined}
                      title={g.description}
                      className={cx(
                        "flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors 2xl:px-4",
                        active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {ICONS[g.icon]}
                      <span className="flex flex-col leading-tight">
                        <span>{g.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-0">
            {sites.length > 1 && <div className="hidden xl:block">{siteSwitcher}</div>}
            {/* Scan for every role at every width (brief: camera scan entry on mobile). */}
            <Link
              href="/inventory/scan"
              className={cx("flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg", pathname.startsWith("/inventory/scan") && "text-primary-text")}
              aria-label="Scan or search"
              title="Scan or search"
            >
              <ScanLine size={18} aria-hidden />
              <span className="md:hidden">Scan</span>
              <span className="hidden md:inline xl:hidden 2xl:inline">Scan or search</span>
            </Link>
            <div className="hidden sm:block">
              <SyncChip userId={user.id} />
            </div>
            {/* ADR-075/082/098: "To approve" in the top bar from 640 px; on phones it is a tab of Home (one door). */}
            {showApprovals && (
              <Link
                href="/approvals"
                className={cx("relative hidden h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg sm:flex", pathname.startsWith("/approvals") && "text-primary-text")}
                aria-label={`To approve, ${approvalCount} waiting`}
                title="To approve"
              >
                <ListChecks size={18} aria-hidden />
                <span className="hidden whitespace-nowrap md:inline xl:hidden 2xl:inline">To approve</span>
                {approvalCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{approvalCount > 99 ? "99+" : approvalCount}</span>
                )}
              </Link>
            )}
            <Link href="/notifications" className={cx("relative flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg", pathname.startsWith("/notifications") && "text-primary-text")} aria-label={`Messages, ${unreadCount} unread`} title="Messages">
              <Bell size={18} aria-hidden />
              <span className="hidden md:inline xl:hidden 2xl:inline">Messages</span>
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </Link>
            <details className="relative shrink-0">
              <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-full text-[13px] font-semibold ring-2 ring-white [&::-webkit-details-marker]:hidden" style={{ background: "var(--lime-200)", color: "var(--brand-800)" }} aria-label="Account">
                {initials}
              </summary>
              <div className="absolute right-0 top-12 z-40 w-64 max-w-[calc(100vw-32px)] rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
                <p className="font-semibold text-fg">{user.name}</p>
                <p className="text-[12px] text-muted">{user.roles}</p>
                <p className="mt-2 text-[12px] text-muted">Site: {site?.code} · {site?.name}</p>
                <Link href="/account" className="mt-2 flex min-h-[44px] items-center text-[13px] font-medium text-primary-text hover:underline">My account and devices</Link>
                {demo?.canReset && <Link href="/admin/demo" className="flex min-h-[44px] items-center text-[13px] font-medium text-primary-text hover:underline">Reset demo data</Link>}
                <div className="mt-2 border-t border-line pt-1">
                  <SignOutButton signOut={signOut} variant="menu" />
                </div>
              </div>
            </details>
          </div>
        </div>
        {/* Desktop: tabs of the active destination; each named section is one small menu (Planning tools and IT and system last). */}
        {activeGroup && (() => {
          const { main: allMain, sections } = groupSections(activeGroup);
          const main = allMain.filter((i) => inTabRow(i) && i.topBar !== "wide");
          if (main.length + sections.length <= 1) return null;
          const pill = (i: NavItem) => (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={i.href === activeHref ? "page" : undefined}
                aria-label={badges[i.href] ? withCount(i.label, i.href) : undefined}
                className={cx(
                  "flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors",
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
                <li className="mr-1 hidden text-[13px] text-muted xl:block">
                  {activeGroup.description}
                </li>
                {main.map(pill)}
                {sections.map((sec) => {
                  const here = sec.items.some((i) => i.href === activeHref);
                  const { daily, advanced } = splitAdvanced(sec.items);
                  return (
                    <li key={sec.name}>
                      {/* keyed by path so an open menu closes after navigating */}
                      <details className="relative" key={pathname}>
                        <summary className={cx("flex min-h-[44px] cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden", here ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2 hover:text-fg")}>
                          {sec.name}
                          <ChevronDown size={14} aria-hidden />
                        </summary>
                        <div className="absolute left-0 top-12 z-40 w-72 rounded-[16px] border border-line bg-surface p-2 shadow-[var(--shadow-pop)]">
                          <ul>{daily.map(dropItem)}</ul>
                          {advanced.length > 0 && (
                            <details className="mt-1 border-t border-line pt-1" open={advanced.some((i) => i.href === activeHref)}>
                              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-[10px] px-3 text-[13px] font-medium text-muted hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                                Advanced <ChevronDown size={14} aria-hidden />
                              </summary>
                              <ul>{advanced.map(dropItem)}</ul>
                            </details>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}
        {/* Phones and tablets (below 1280 px): the destination's main tabs in one swipeable row with a fade
            at the edge; "More" stays visible at the right and opens the menu at this destination. */}
        {activeGroup && (() => {
          const { main: allMain, sections } = groupSections(activeGroup);
          const main = allMain.filter(inTabRow);
          // A lone tab (or a lone "More") is noise: the Menu tab and the destination's landing page reach the rest.
          if (main.length <= 1) return null;
          const moreHere = sections.some((x) => x.items.some((i) => i.href === activeHref));
          return (
            <nav aria-label={`${activeGroup.label} pages`} className="xl:hidden">
              <div className="mx-auto flex max-w-[1480px] items-center gap-1.5 px-4 pb-2.5 sm:px-6">
                <div className="relative min-w-0 flex-1">
                  <ul ref={rowRef} className="scroll-x-hidden flex gap-1.5 overflow-x-auto">
                    {main.map((i) => (
                      <li key={i.href} className={cx("shrink-0", rowItemClass(i))}>
                        <Link
                          href={i.href}
                          aria-current={i.href === activeHref ? "page" : undefined}
                          aria-label={badges[i.href] ? withCount(i.label, i.href) : undefined}
                          className={cx("flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium", i.href === activeHref ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2")}
                        >
                          {i.label}
                          <CountBadge n={badges[i.href]} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {fade && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[var(--bg)] to-transparent" data-testid="tab-row-fade" />}
                </div>
                {sections.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDrawer(true)}
                    aria-label={`More ${activeGroup.label} pages`}
                    className={cx("flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium", moreHere ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2")}
                  >
                    More <ChevronDown size={14} aria-hidden />
                  </button>
                )}
              </div>
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
          <aside className="absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col overflow-y-auto bg-surface p-4 shadow-xl" aria-label="Menu">
            <div className="mb-4 flex items-center justify-between">
              <Logo className="h-8 w-auto" />
              <button className="grid size-11 place-items-center rounded-full bg-surface-2" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            {sites.length > 1 && <div className="mb-3">{siteSwitcher}</div>}
            <div className="mb-4">
              <DrawerSync userId={user.id} />
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
                    <Link href={i.href} aria-current={i.href === activeHref ? "page" : undefined} aria-label={badges[i.href] ? withCount(i.label, i.href) : undefined} className={cx("flex min-h-[44px] items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-[14px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
                      {i.label}
                      <CountBadge n={badges[i.href]} />
                    </Link>
                  </li>
                );
              return (
                <details key={g.label} className="mb-1 border-b border-line pb-1" open={g === activeGroup}>
                  <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2.5 px-2 text-[16px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
                    {ICONS[g.icon]}
                    <span className="flex flex-1 flex-col leading-tight">
                      {g.label}
                      <span className="text-[12px] font-normal text-muted">{g.description}</span>
                    </span>
                    <ChevronDown size={18} className="text-muted" aria-hidden />
                  </summary>
                  <ul>{main.map(row)}</ul>
                  {sections.map((sec) => {
                    const { daily, advanced } = splitAdvanced(sec.items);
                    return (
                      <details key={sec.name} className="mt-0.5" open={sec.items.some((i) => i.href === activeHref)}>
                        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-[14px] font-medium text-fg-2 [&::-webkit-details-marker]:hidden">{sec.name}<ChevronDown size={16} aria-hidden /></summary>
                        <ul className="pl-2">{daily.map(row)}</ul>
                        {advanced.length > 0 && (
                          <details className="pl-2" open={advanced.some((i) => i.href === activeHref)}>
                            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-[13px] font-medium text-muted [&::-webkit-details-marker]:hidden">Advanced<ChevronDown size={14} aria-hidden /></summary>
                            <ul className="pl-2">{advanced.map(row)}</ul>
                          </details>
                        )}
                      </details>
                    );
                  })}
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
