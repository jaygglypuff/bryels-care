"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BarChart3, Bell, Boxes, Building2, CalendarDays, ChevronDown, ClipboardList, Clock, Cloud, CloudOff, CloudUpload, Database, Factory, FlaskConical, GitBranch, GitMerge, HelpCircle, Home,
  ListChecks, Menu, PackagePlus, PhilippinePeso, ScanLine, ScrollText, Settings, ShieldCheck, ShoppingCart, Truck, UserRound, Warehouse, Wrench, X,
} from "lucide-react";
import { activeEntry, groupHref, groupSections, MORE, type NavBadges, type NavGroup, type NavItem, type Tab } from "./nav";
import { cx } from "@/ui/core";
import { Logo, LogoMark } from "@/ui/brand";
import { NavigationProgress } from "@/ui/navigation-progress";
import { DemoBanner } from "@/ui/demo-banner";
import { SignOutButton, SyncChip, useSync } from "@/ui/sync-status";
import { FrameHelp, type FrameHelpResult } from "@/ui/help/frame-help";
import { MasterSearchLauncher, type SearchFn } from "@/ui/master-search";
import type { SyncState } from "@/lib/offline/agent";

const ICONS: Record<string, React.ReactNode> = {
  home: <Home size={18} />, boxes: <Boxes size={18} />, factory: <Factory size={18} />, shield: <ShieldCheck size={18} />,
  truck: <Truck size={18} />, warehouse: <Warehouse size={18} />, wrench: <Wrench size={18} />, database: <Database size={18} />, settings: <Settings size={18} />, clock: <Clock size={18} />,
  scan: <ScanLine size={19} />, receive: <PackagePlus size={19} />, batch: <FlaskConical size={19} />, qa: <ClipboardList size={19} />,
  order: <ShoppingCart size={19} />, trace: <GitBranch size={19} />, audit: <ScrollText size={19} />, approve: <ListChecks size={19} />,
  money: <PhilippinePeso size={18} />, customer: <UserRound size={18} />, supplier: <Building2 size={18} />, alert: <AlertTriangle size={18} />, chart: <BarChart3 size={18} />,
};

const TAB_ICONS: Record<Tab["icon"], React.ReactNode> = {
  home: <Home size={20} />, today: <CalendarDays size={20} />, scan: <ScanLine size={20} />, help: <HelpCircle size={20} />, factory: <Factory size={20} />,
  truck: <Truck size={20} />, approve: <ListChecks size={20} />, shield: <ShieldCheck size={20} />, boxes: <Boxes size={20} />, receive: <PackagePlus size={20} />,
  money: <PhilippinePeso size={20} />, customer: <UserRound size={20} />, order: <ShoppingCart size={20} />, trace: <GitBranch size={20} />, alert: <AlertTriangle size={20} />,
  chart: <BarChart3 size={20} />, clock: <Clock size={20} />, supplier: <Building2 size={20} />,
};

type Props = {
  nav: NavGroup[];
  /** Bottom bar per role (tabsFor in nav.ts); floor roles see these four doors as the top-bar menu from 1280 px. */
  tabs: Tab[];
  user: { id: string; name: string; roles: string };
  sites: { id: string; code: string; name: string }[];
  currentSiteId: string;
  /** Where Home is for this person (the logo and the Home pill). */
  homeHref?: string;
  /** Floor role (A report): no tab rows, no menu button, no Help "?" in the bar; the bottom bar holds Help. */
  floor?: boolean;
  /** Owner, site manager and the roles that share their menu: "Needs me" replaces the To approve and Messages buttons. */
  needsMeArea?: boolean;
  /** Set-up screens this person may open (the avatar menu shows "Set-up"). */
  hasSetup?: boolean;
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
  /** Round 4: the frame's Help "?" loads the guide of the current screen (server action). Without it, no button. */
  loadHelp?: (pathname: string) => Promise<FrameHelpResult>;
  /** Master search (ADR-121, round 5): a labelled "Search" at every width, Ctrl/⌘+K and "/". Without it, no search. */
  search?: SearchFn;
  /**
   * ADR-126 setting `ui.wide_screen_top_bar`: "search" (default) shows the Search box; "scan" shows the Scan button in its
   * place at every width (Ctrl/⌘K and "/" still open the search).
   */
  wideTopBar?: "search" | "scan";
  /** ADR-126 (`scan.search_open_to_everyone` off and no stock access): no Scan button (the screen would refuse). */
  showScan?: boolean;
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

/** Small count badge; hidden at zero. */
function CountBadge({ n, className }: { n: number | undefined; className?: string }) {
  if (!n) return null;
  return (
    <span className={cx("grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white", className)} aria-hidden="true">
      {n > 99 ? "99+" : n}
    </span>
  );
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

/**
 * The app frame (round 5, ADR-129; docs/NEW_NAVIGATION.md). Top bar: menu (owner and office roles from 1280 px: one
 * pill per area), then the labelled Search, then To approve / Messages / Help where the role has them, then the avatar
 * (My account, Help, Set-up, All screens, sign out). Under it the open area's tabs (at most five, then one flat "More").
 * Phones and tablets: one ☰ (not for floor roles) and the role's bottom bar. Esc closes the drawer and the menus.
 */
export function Shell({ nav, tabs, user, sites, currentSiteId, homeHref = "/dashboard", floor = false, needsMeArea = false, hasSetup = false, qaCount, unreadCount, approvalCount = 0, showApprovals = true, switchSite, signOut, loadHelp, search, wideTopBar = "search", showScan = true, demo = null, children }: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const accountRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => setDrawer(false), [pathname]);
  // B report bug B12: Esc closes the drawer (and any open menu of the frame).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawer(false);
      document.querySelectorAll<HTMLDetailsElement>("details[data-frame-menu][open]").forEach((d) => d.removeAttribute("open"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Close the frame's menus after navigating.
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details[data-frame-menu][open]").forEach((d) => d.removeAttribute("open"));
  }, [pathname]);

  // Phone/tablet tab row: a fade at the right edge while more tabs are hidden, and the open tab scrolled into view.
  const rowRef = useRef<HTMLUListElement>(null);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
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

  const { group: activeGroup, href: activeHref } = activeEntry(nav, pathname);
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const site = sites.find((s) => s.id === currentSiteId);
  const needsMe = approvalCount + unreadCount;
  const badges: NavBadges = { ...(qaCount ? { "/quality": qaCount } : {}), ...(approvalCount ? { "/approvals": approvalCount } : {}), ...(unreadCount ? { "/notifications": unreadCount } : {}) };
  const areaBadge = (g: NavGroup) => (g.label === "Needs me" ? needsMe : 0);
  const tabBadge = (t: Tab) => (t.needsMe ? needsMe : badges[t.href]);
  // Only the closest tab lights up (/inventory/receive must not also light up /inventory).
  const activeTab = tabs.reduce<{ href: string | null; m: number }>((best, t) => {
    const path = t.href.split("?")[0];
    const m = pathname === path ? path.length + 1000 : pathname.startsWith(path + "/") ? path.length : -1;
    return m > best.m ? { href: t.href, m } : best;
  }, { href: null, m: -1 }).href;
  const tightTopBar = sites.length > 1;
  // ADR-126: the Scan button in the search box's place (setting ui.wide_screen_top_bar = "scan").
  const scanFirst = wideTopBar === "scan" && showScan;
  const withCount = (label: string, n: number | undefined) => (n ? `${label}, ${n} open` : label);
  const topButton = "relative flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg";

  // Round 4 (UX re-audit C N4): the site's NAME, never cut ("North Fields Plant"); the code is in the tooltip only.
  const siteSwitcher = (wide: boolean) => (
    <form action={switchSite} className={cx("flex items-center", wide && "w-full")}>
      <input type="hidden" name="returnTo" value={pathname} />
      <label htmlFor={wide ? "site-switch-drawer" : "site-switch"} className="sr-only">Site</label>
      <select
        id={wide ? "site-switch-drawer" : "site-switch"}
        name="siteId"
        defaultValue={currentSiteId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        title={site ? `${site.name} (${site.code})` : undefined}
        data-testid={wide ? "site-switch-drawer" : "site-switch"}
        className={cx("h-11 cursor-pointer rounded-full border border-line bg-surface pl-3 pr-8 text-[13px] font-medium text-fg shadow-[var(--shadow-card)]", wide ? "w-full" : "w-auto")}
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </form>
  );

  /** One entry of the flat "More" list (desktop). */
  const dropItem = (i: NavItem) => (
    <li key={i.href}>
      <Link href={i.href} aria-current={i.href === activeHref ? "page" : undefined} className={cx("flex min-h-[44px] items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[14px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
        {i.label}
        <CountBadge n={badges[i.href]} />
      </Link>
    </li>
  );

  // Top-bar menu from 1280 px: the areas (owner and office roles) or the four floor doors (floor roles).
  const pills: { key: string; label: string; href: string; icon: React.ReactNode; active: boolean; badge: number | undefined; title?: string }[] = floor
    ? tabs.map((t) => ({ key: t.href, label: t.label, href: t.href, icon: TAB_ICONS[t.icon], active: t.href === activeTab, badge: tabBadge(t) }))
    : nav.map((g) => ({ key: g.label, label: g.label, href: groupHref(g), icon: ICONS[g.icon], active: g === activeGroup, badge: areaBadge(g), title: g.description }));

  const scanButton = (
    <Link
      href="/inventory/scan"
      data-testid="top-bar-scan"
      className={cx(topButton, pathname.startsWith("/inventory/scan") && "text-primary-text")}
      aria-label="Scan a label"
      title="Scan a label"
    >
      <ScanLine size={18} aria-hidden />
      <span>Scan</span>
    </Link>
  );

  return (
    <div className="min-h-dvh pb-[76px] xl:pb-0">
      <NavigationProgress />
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
        {demo && <DemoBanner canReset={demo.canReset} sandbox={demo.sandbox} />}
        <div className="mx-auto flex h-[68px] max-w-[1480px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
          {/* One menu button (B report B12, C report): the drawer. Floor roles have none (their four doors are below). */}
          {!floor && (
            <button className="grid size-11 shrink-0 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)] xl:hidden" onClick={() => setDrawer(true)} aria-label="Open menu" data-testid="open-menu">
              <Menu size={18} />
            </button>
          )}
          <Link href={homeHref} className="grid min-h-11 min-w-11 shrink-0 place-items-center" aria-label="Bryel's Care home">
            {/* ADR-123: from 1280 px the menu shares the bar with Search; the mark (36 px) shows there, the full logo from 1536 px. */}
            <LogoMark className="size-9 sm:hidden xl:block 2xl:hidden" />
            <Logo className="hidden h-9 w-auto sm:block xl:hidden 2xl:block" />
          </Link>
          {/* Areas from 1280 px, starting next to the logo (B report #1: the Search box comes right after). */}
          <nav aria-label="Menu" className="hidden min-w-0 xl:block" data-testid="top-menu">
            <ul className="scroll-x-hidden flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-[var(--shadow-card)]">
              {pills.map((p) => (
                <li key={p.key}>
                  <Link
                    href={p.href}
                    aria-current={p.active ? "page" : undefined}
                    aria-label={p.badge ? withCount(p.label, p.badge) : undefined}
                    title={p.title}
                    className={cx("relative flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors", p.active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}
                  >
                    {p.icon}
                    <span>{p.label}</span>
                    <CountBadge n={p.badge} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {/* Search, labelled, at every width (round 5). ADR-126 "scan": the Scan button stands in its place. */}
          <div className={cx("flex min-w-0 items-center", !scanFirst && "flex-1 xl:flex-none")}>
            {search && <MasterSearchLauncher search={search} userId={user.id} keysOnly={scanFirst} tight={tightTopBar} />}
            {scanFirst && scanButton}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {sites.length > 1 && <div className="hidden shrink-0 xl:block">{siteSwitcher(false)}</div>}
            {/* The sync chip shows only when something waits to be sent or there is no signal (round 5). */}
            <SyncChip userId={user.id} />
            {/* ADR-075/082: "To approve" for office approvers (owner and manager: it is in "Needs me"). */}
            {showApprovals && !needsMeArea && !floor && (
              <Link
                href="/approvals"
                className={cx(topButton, "hidden sm:flex", pathname.startsWith("/approvals") && "text-primary-text")}
                aria-label={`To approve, ${approvalCount} waiting`}
                title="To approve"
                data-testid="top-bar-approvals"
              >
                <ListChecks size={18} aria-hidden />
                <span className={cx("hidden whitespace-nowrap", tightTopBar ? "2xl:inline" : "md:inline")}>To approve</span>
                <CountBadge n={approvalCount} className="absolute -right-0.5 -top-0.5" />
              </Link>
            )}
            {/* Messages: the bell with its word where it fits (owner and manager: in "Needs me"). */}
            {!needsMeArea && (
              <Link href="/notifications" className={cx(topButton, pathname.startsWith("/notifications") && "text-primary-text")} aria-label={`Messages, ${unreadCount} unread`} title="Messages" data-testid="top-bar-messages">
                <Bell size={18} aria-hidden />
                <span className={cx("hidden", tightTopBar ? "2xl:inline" : "md:inline")}>Messages</span>
                <CountBadge n={unreadCount} className="absolute -right-0.5 -top-0.5" />
              </Link>
            )}
            {/* One "?" (floor roles have Help in the bottom bar instead). */}
            {loadHelp && !floor && (
              <div className="hidden sm:block">
                <FrameHelp load={loadHelp} withLabel labelClass={cx("hidden", tightTopBar ? "2xl:inline" : "lg:inline")} />
              </div>
            )}
            <details className="relative shrink-0" data-frame-menu ref={accountRef}>
              <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-full text-[13px] font-semibold ring-2 ring-white [&::-webkit-details-marker]:hidden" style={{ background: "var(--lime-200)", color: "var(--brand-800)" }} aria-label="Your account, help and set-up" data-testid="account-menu">
                {initials}
              </summary>
              <div className="absolute right-0 top-12 z-40 w-64 max-w-[calc(100vw-32px)] rounded-[18px] border border-line bg-surface p-3 shadow-[var(--shadow-pop)]">
                <p className="px-1 font-semibold text-fg">{user.name}</p>
                <p className="px-1 text-[12px] text-muted">{user.roles}</p>
                <p className="mt-1 px-1 text-[12px] text-muted">Site: {site?.name}</p>
                <ul className="mt-2 border-t border-line pt-1">
                  <li><Link href="/account" className="flex min-h-[44px] items-center rounded-[10px] px-2 text-[14px] font-medium text-fg hover:bg-surface-2">My account and devices</Link></li>
                  <li><Link href="/help" className="flex min-h-[44px] items-center rounded-[10px] px-2 text-[14px] font-medium text-fg hover:bg-surface-2">Help</Link></li>
                  {hasSetup && <li><Link href="/setup" className="flex min-h-[44px] items-center rounded-[10px] px-2 text-[14px] font-medium text-fg hover:bg-surface-2" data-testid="account-setup">Set-up</Link></li>}
                  <li>
                    <button type="button" onClick={() => { accountRef.current?.removeAttribute("open"); setDrawer(true); }} className="flex min-h-[44px] w-full items-center rounded-[10px] px-2 text-left text-[14px] font-medium text-fg hover:bg-surface-2" data-testid="account-all-screens">
                      All screens
                    </button>
                  </li>
                  {demo?.canReset && <li><Link href="/admin/demo" className="flex min-h-[44px] items-center rounded-[10px] px-2 text-[14px] font-medium text-fg hover:bg-surface-2">Reset demo data</Link></li>}
                </ul>
                <div className="mt-1 border-t border-line pt-1">
                  <SignOutButton signOut={signOut} variant="menu" />
                </div>
              </div>
            </details>
          </div>
        </div>
        {/* Desktop: the open area's tabs (at most five) and one flat "More" list. Floor roles have none. */}
        {!floor && activeGroup && (() => {
          const { main, sections } = groupSections(activeGroup);
          const more = sections.find((s) => s.name === MORE)?.items ?? [];
          if (main.length + more.length <= 1) return null;
          const moreHere = more.some((i) => i.href === activeHref);
          return (
            <div className="mx-auto hidden max-w-[1480px] px-4 pb-3 sm:px-6 xl:block">
              <ul className="flex flex-wrap items-center gap-1.5" data-testid="desktop-tab-row">
                {main.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={i.href === activeHref ? "page" : undefined}
                      aria-label={badges[i.href] ? withCount(i.label, badges[i.href]) : undefined}
                      className={cx("flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors", i.href === activeHref ? "border-transparent text-white" : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg")}
                      style={i.href === activeHref ? { background: "var(--brand-600)" } : undefined}
                    >
                      {i.label}
                      <CountBadge n={badges[i.href]} />
                    </Link>
                  </li>
                ))}
                {more.length > 0 && (
                  <li>
                    <details className="relative" data-frame-menu data-testid="desktop-more">
                      <summary className={cx("flex min-h-[44px] cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden", moreHere ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2 hover:text-fg")}>
                        More
                        <ChevronDown size={14} aria-hidden />
                      </summary>
                      <div className="absolute left-0 top-12 z-40 max-h-[70vh] w-72 overflow-y-auto rounded-[16px] border border-line bg-surface p-2 shadow-[var(--shadow-pop)]">
                        <ul>{more.map(dropItem)}</ul>
                      </div>
                    </details>
                  </li>
                )}
              </ul>
            </div>
          );
        })()}
        {/* Phones and tablets: the open area's tabs in one swipeable row with a fade; "More" opens the menu. */}
        {!floor && activeGroup && (() => {
          const { main, sections } = groupSections(activeGroup);
          if (main.length <= 1) return null;
          const more = sections.find((s) => s.name === MORE)?.items ?? [];
          const moreHere = more.some((i) => i.href === activeHref);
          return (
            <nav aria-label={`${activeGroup.label} pages`} className="xl:hidden">
              <div className="mx-auto flex max-w-[1480px] items-center gap-1.5 px-4 pb-2.5 sm:px-6">
                <div className="relative min-w-0 flex-1">
                  <ul ref={rowRef} className="scroll-x-hidden flex gap-1.5 overflow-x-auto">
                    {main.map((i) => (
                      <li key={i.href} className="shrink-0">
                        <Link
                          href={i.href}
                          aria-current={i.href === activeHref ? "page" : undefined}
                          aria-label={badges[i.href] ? withCount(i.label, badges[i.href]) : undefined}
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
                {more.length > 0 && (
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
        <main id="main" className="min-w-0 flex-1 py-5 sm:py-7">
          <DeletedNotice pathname={pathname} />
          {children}
        </main>
      </div>

      {/* Bottom bar (phones and tablets): the role's doors, never a second menu button. */}
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden">
        <ul className="mx-auto flex max-w-[560px] justify-around">
          {tabs.map((t) => {
            const active = t.href === activeTab;
            const n = tabBadge(t);
            return (
              <li key={t.href} className="min-w-0 flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} aria-label={n ? withCount(t.label, n) : undefined} className={cx("flex min-h-[56px] flex-col items-center gap-0.5 px-1 py-2 text-center text-[11px] font-medium leading-tight", active ? "text-primary-text" : "text-muted")}>
                  <span className={cx("relative grid h-7 w-12 place-items-center rounded-full", active && "bg-[var(--lime-100)]")}>
                    {TAB_ICONS[t.icon]}
                    <CountBadge n={n} className="absolute -right-0.5 -top-1" />
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Drawer: the ☰ button (phones and tablets) or "All screens" in the avatar menu (every width). */}
      {drawer && (
        <div className="fixed inset-0 z-50" data-testid="drawer">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[320px] max-w-[86vw] flex-col overflow-y-auto bg-surface p-4 shadow-xl" aria-label="Menu" role="dialog" aria-modal="true">
            <div className="mb-4 flex items-center justify-between">
              <Logo className="h-8 w-auto" />
              <button className="grid size-11 place-items-center rounded-full bg-surface-2" onClick={() => setDrawer(false)} aria-label="Close menu" autoFocus><X size={18} /></button>
            </div>
            {sites.length > 1 && <div className="mb-3">{siteSwitcher(true)}</div>}
            <div className="mb-4">
              <DrawerSync userId={user.id} />
            </div>
            {nav.map((g) => {
              const { main, sections } = groupSections(g);
              const more = sections.flatMap((s) => s.items);
              const row = (i: NavItem) => (
                <li key={i.href}>
                  <Link href={i.href} aria-current={i.href === activeHref ? "page" : undefined} aria-label={badges[i.href] ? withCount(i.label, badges[i.href]) : undefined} className={cx("flex min-h-[44px] items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-[15px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>
                    {i.label}
                    <CountBadge n={badges[i.href]} />
                  </Link>
                </li>
              );
              if (main.length + more.length <= 1)
                return (
                  <Link key={g.label} href={groupHref(g)} className="mb-1 flex min-h-[52px] items-center gap-2.5 border-b border-line px-2 pb-1 text-[16px] font-semibold text-fg">
                    {ICONS[g.icon]}
                    {g.label}
                  </Link>
                );
              return (
                <details key={g.label} className="mb-1 border-b border-line pb-1" open={g === activeGroup}>
                  <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2.5 px-2 text-[16px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
                    {ICONS[g.icon]}
                    <span className="flex flex-1 flex-col leading-tight">
                      {g.label}
                      {g.description && <span className="text-[12px] font-normal text-muted">{g.description}</span>}
                    </span>
                    <CountBadge n={areaBadge(g)} />
                    <ChevronDown size={18} className="text-muted" aria-hidden />
                  </summary>
                  <ul>{main.map(row)}</ul>
                  {more.length > 0 && (
                    <>
                      <p className="px-3 pb-0.5 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted">More</p>
                      <ul>{more.map(row)}</ul>
                    </>
                  )}
                </details>
              );
            })}
            <ul className="mt-2">
              {hasSetup && (
                <li>
                  <Link href="/setup" className="flex min-h-[48px] items-center gap-2.5 px-2 text-[16px] font-semibold text-fg">
                    <Settings size={18} aria-hidden /> Set-up
                  </Link>
                </li>
              )}
              <li>
                <Link href="/help" className="flex min-h-[48px] items-center gap-2.5 px-2 text-[16px] font-semibold text-fg">
                  <HelpCircle size={18} aria-hidden /> Help
                </Link>
              </li>
            </ul>
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
