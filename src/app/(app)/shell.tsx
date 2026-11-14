"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BarChart3, Bell, Boxes, Building2, CalendarDays, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Clock, Cloud, CloudOff, CloudUpload, Database, Factory, FlaskConical, GitBranch, GitMerge,
  HelpCircle, Home, ListChecks, Menu, PackagePlus, PhilippinePeso, ScanLine, ScrollText, Settings, ShieldCheck, ShoppingCart, SlidersHorizontal, Truck, UserRound, Warehouse, Wrench, X,
} from "lucide-react";
import { activeEntry, crumbsFor, groupEntries, groupHref, type NavBadges, type NavGroup, type NavItem, type Tab } from "./nav";
import { cx } from "@/ui/core";
import { Logo, LogoMark } from "@/ui/brand";
import { NavigationProgress } from "@/ui/navigation-progress";
import { SavedLanding } from "@/ui/saved-landing";
import { DemoBanner } from "@/ui/demo-banner";
import { RowClicks } from "@/ui/kit-client";
import { SignOutButton, SyncChip, useSync } from "@/ui/sync-status";
import { FrameHelp, type FrameHelpResult } from "@/ui/help/frame-help";
import { MasterSearchLauncher, type SearchFn } from "@/ui/master-search";
import type { SyncState } from "@/lib/offline/agent";

const ICONS: Record<string, React.ReactNode> = {
  home: <Home size={16} />, boxes: <Boxes size={16} />, factory: <Factory size={16} />, shield: <ShieldCheck size={16} />,
  truck: <Truck size={16} />, warehouse: <Warehouse size={16} />, wrench: <Wrench size={16} />, database: <Database size={16} />, settings: <Settings size={16} />, clock: <Clock size={16} />,
  scan: <ScanLine size={16} />, receive: <PackagePlus size={16} />, batch: <FlaskConical size={16} />, qa: <ClipboardList size={16} />,
  order: <ShoppingCart size={16} />, trace: <GitBranch size={16} />, audit: <ScrollText size={16} />, approve: <ListChecks size={16} />,
  money: <PhilippinePeso size={16} />, customer: <UserRound size={16} />, supplier: <Building2 size={16} />, alert: <AlertTriangle size={16} />, chart: <BarChart3 size={16} />,
};

const TAB_ICONS: Record<Tab["icon"], React.ReactNode> = {
  home: <Home size={20} />, today: <CalendarDays size={20} />, scan: <ScanLine size={20} />, help: <HelpCircle size={20} />, factory: <Factory size={20} />,
  truck: <Truck size={20} />, approve: <ListChecks size={20} />, shield: <ShieldCheck size={20} />, boxes: <Boxes size={20} />, receive: <PackagePlus size={20} />,
  money: <PhilippinePeso size={20} />, customer: <UserRound size={20} />, order: <ShoppingCart size={20} />, trace: <GitBranch size={20} />, alert: <AlertTriangle size={20} />,
  chart: <BarChart3 size={20} />, clock: <Clock size={20} />, supplier: <Building2 size={20} />,
};

type Props = {
  nav: NavGroup[];
  /** Bottom bar per role (tabsFor in nav.ts), below 1024 px. */
  tabs: Tab[];
  user: { id: string; name: string; roles: string };
  sites: { id: string; code: string; name: string }[];
  currentSiteId: string;
  /** Where Home is for this person (the logo and the Home entry). */
  homeHref?: string;
  /** Floor role (A report): below 1024 px no menu button and no Help "?" in the bar; the bottom bar holds their doors. */
  floor?: boolean;
  /** Owner, site manager and the roles that share their menu: "Needs me" replaces the To approve and Messages buttons. */
  needsMeArea?: boolean;
  /** Set-up screens this person may open (the sidebar's foot and the avatar menu show "Set-up"). */
  hasSetup?: boolean;
  /** The person may open Settings (/admin/settings): a second entry in the sidebar's foot. */
  hasSettings?: boolean;
  /** Open QA queue items at the current site (QA users only): count on the QA entries. */
  qaCount: number | null;
  /** Open, unread in-app notifications of the signed-in user (US-2-03). */
  unreadCount: number;
  /** ADR-075: approvals waiting for the signed-in user (the "To approve" count). */
  approvalCount?: number;
  /** ADR-132 §1: things waiting for this person (approvals + checks + action messages); the "Needs me" count. */
  needsMeCount?: number;
  /** ADR-082: show "To approve" only to people who approve something. */
  showApprovals?: boolean;
  switchSite: (fd: FormData) => Promise<void>;
  signOut: () => Promise<void>;
  /** Round 4: the frame's Help "?" loads the guide of the current screen (server action). Without it, no button. */
  loadHelp?: (pathname: string) => Promise<FrameHelpResult>;
  /** Master search (ADR-121, round 5): the box in the middle of the top bar, Ctrl/⌘+K and "/". Without it, no search. */
  search?: SearchFn;
  /** ADR-126 setting `ui.wide_screen_top_bar`: "scan" shows the Scan button in the search box's place. */
  wideTopBar?: "search" | "scan";
  /** ADR-126 (`scan.search_open_to_everyone` off and no stock access): no Scan button (the screen would refuse). */
  showScan?: boolean;
  /** Demo mode (ADR-055): the slim line above the top bar; `canReset` adds the owner's reset link. Null outside the demo. */
  demo?: { canReset: boolean; sandbox?: boolean } | null;
  children: React.ReactNode;
};

/** "Draft deleted." after a delete redirected here with ?deleted=1 (ADR-075); read from the URL after navigation. */
function DeletedNotice({ pathname }: { pathname: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(new URLSearchParams(window.location.search).get("deleted") === "1"), [pathname]);
  if (!show) return null;
  return (
    <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-[8px] border border-line bg-surface px-4 py-2 text-[14px]">
      <span>Draft deleted. A copy is kept in the audit log.</span>
      <button type="button" onClick={() => setShow(false)} className="grid min-h-[36px] min-w-[36px] place-items-center rounded-[6px] text-fg-2 hover:bg-surface-3 pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}

/** Small count; hidden at zero. `tone="alert"` (red) for things waiting for the person. */
function CountBadge({ n, className, tone = "alert" }: { n: number | undefined; className?: string; tone?: "alert" | "muted" }) {
  if (!n) return null;
  return (
    <span className={cx("grid h-[18px] min-w-[18px] place-items-center rounded-[9px] px-1 text-[11px] font-semibold tabular", tone === "alert" ? "bg-[var(--bad-fg)] text-white" : "bg-surface-3 text-fg-2", className)} aria-hidden="true">
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
  const icon = w.tone === "ok" ? <Cloud size={16} aria-hidden /> : w.tone === "bad" ? (s.stats.conflict ? <GitMerge size={16} aria-hidden /> : <CloudOff size={16} aria-hidden />) : s.online ? <CloudUpload size={16} aria-hidden /> : <CloudOff size={16} aria-hidden />;
  return (
    <Link href="/sync" className={cx("flex min-h-[44px] items-center gap-2 rounded-[6px] border px-3 text-[14px] font-medium", SYNC_TONE[w.tone])} data-testid="drawer-sync">
      {icon}
      <span>{w.text}</span>
    </Link>
  );
}

const SIDEBAR_KEY = "bc.sidebar";
const CLOSED_KEY = "bc.sidebar.closed";
const readStore = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode or storage full: the choice is not remembered, nothing else changes */
  }
};

/** Arrow keys move between the links and buttons of a menu (sidebar and drawer); Home/End jump to the ends. */
function arrowKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter((el) => el.offsetParent !== null);
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/**
 * The app frame (ADR-136, replaces the pill menus of ADR-129's top bar; the menus per job in nav.ts are unchanged).
 *
 * From 1024 px: a fixed left sidebar (240 px, or 64 px icons only, remembered on the device) with the whole two-level
 * menu always visible: each area (Home, Needs me, Sell, Make, Buy & stock, Money …) with its pages listed under it, no
 * "More" dropdowns; Set-up, Settings and Help at the foot. The open page has a tinted background and a green bar. The
 * 56 px top bar holds the breadcrumb (Section / Page / record), the Search box in the middle (Ctrl/⌘K, "/"), the site
 * switcher, Help "?" and the avatar menu. Below 1024 px: office roles open the same menu in a drawer from ☰; every
 * role keeps its bottom bar (floor roles: their four doors, no ☰). Esc closes the drawer and the menus.
 */
export function Shell({ nav, tabs, user, sites, currentSiteId, homeHref = "/dashboard", floor = false, needsMeArea = false, hasSetup = false, hasSettings = false, qaCount, unreadCount, approvalCount = 0, needsMeCount, showApprovals = true, switchSite, signOut, loadHelp, search, wideTopBar = "search", showScan = true, demo = null, children }: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  const accountRef = useRef<HTMLDetailsElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  useEffect(() => setDrawer(false), [pathname]);
  // The sidebar's width and the areas folded by hand, remembered on this device (the layout's script set the width before paint).
  useEffect(() => {
    setCollapsed(readStore(SIDEBAR_KEY) === "collapsed");
    try {
      const v = JSON.parse(readStore(CLOSED_KEY) ?? "[]");
      if (Array.isArray(v)) setClosed(v.filter((x) => typeof x === "string"));
    } catch {
      /* a broken value: every area open */
    }
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStore(SIDEBAR_KEY, next ? "collapsed" : "open");
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
  };
  const toggleArea = (label: string) => {
    const next = closed.includes(label) ? closed.filter((x) => x !== label) : [...closed, label];
    setClosed(next);
    writeStore(CLOSED_KEY, JSON.stringify(next));
  };
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
  // Close the frame's menus after navigating; keep the open page in view in the sidebar.
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details[data-frame-menu][open]").forEach((d) => d.removeAttribute("open"));
    const cur = sideRef.current?.querySelector<HTMLElement>("[aria-current=page]");
    cur?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  // The record or page title as the breadcrumb's last part (read from the page's H1 once it is shown).
  const { crumbs, exact } = crumbsFor(nav, pathname);
  const [tail, setTail] = useState<string | null>(null);
  useEffect(() => {
    setTail(null);
    if (exact) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      const h = document.querySelector<HTMLElement>("main [data-testid=record-number]") ?? document.querySelector<HTMLElement>("main h1");
      const t = h?.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (t) setTail(t.length > 48 ? `${t.slice(0, 46)}…` : t);
      else if (tries++ < 10) timer = setTimeout(read, 150);
    };
    read();
    return () => clearTimeout(timer);
  }, [pathname, exact]);
  const last = crumbs[crumbs.length - 1];
  const trail = [...crumbs, ...(!exact && tail && tail !== last?.label ? [{ label: tail }] : [])];

  const { group: activeGroup, href: activeHref } = activeEntry(nav, pathname);
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const site = sites.find((s) => s.id === currentSiteId);
  const needsMe = needsMeCount ?? approvalCount + unreadCount;
  const badges: NavBadges = { ...(qaCount ? { "/quality": qaCount } : {}), ...(approvalCount ? { "/approvals": approvalCount } : {}), ...(unreadCount ? { "/notifications": unreadCount } : {}) };
  const areaBadge = (g: NavGroup) => (g.label === "Needs me" ? needsMe : 0);
  const tabBadge = (t: Tab) => (t.needsMe ? needsMe : badges[t.href]);
  // Only the closest tab lights up (/inventory/receive must not also light up /inventory).
  const activeTab = tabs.reduce<{ href: string | null; m: number }>((best, t) => {
    const path = t.href.split("?")[0];
    const m = pathname === path ? path.length + 1000 : pathname.startsWith(path + "/") ? path.length : -1;
    return m > best.m ? { href: t.href, m } : best;
  }, { href: null, m: -1 }).href;
  // ADR-126: the Scan button in the search box's place (setting ui.wide_screen_top_bar = "scan").
  const scanFirst = wideTopBar === "scan" && showScan;
  const withCount = (label: string, n: number | undefined) => (n ? `${label}, ${n} open` : label);
  const topButton = "relative flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[13px] font-medium text-fg-2 hover:bg-surface-3 hover:text-fg pointer-coarse:h-11 pointer-coarse:min-w-11";

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
        className={cx("h-9 cursor-pointer rounded-[6px] border border-line-strong bg-surface pl-3 pr-8 text-[13px] font-medium text-fg pointer-coarse:h-11", wide ? "w-full" : "w-auto")}
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </form>
  );

  const scanButton = (
    <Link
      href="/inventory/scan"
      data-testid="top-bar-scan"
      className={cx(topButton, "border border-line-strong", pathname.startsWith("/inventory/scan") && "text-primary-text")}
      aria-label="Scan a label"
      title="Scan a label"
    >
      <ScanLine size={16} aria-hidden />
      <span>Scan</span>
    </Link>
  );

  /** One page of the menu (sidebar and drawer): tinted background and a green bar when open. */
  const entry = (i: NavItem, big = false) => {
    const on = i.href === activeHref;
    const n = badges[i.href];
    return (
      <li key={i.href}>
        <Link
          href={i.href}
          aria-current={on ? "page" : undefined}
          aria-label={n ? withCount(i.label, n) : undefined}
          className={cx(
            "relative flex items-center justify-between gap-2 rounded-[6px] pl-9 pr-2 text-[13.5px] leading-tight",
            big ? "min-h-[44px] py-2 text-[15px]" : "min-h-[32px] py-1.5 pointer-coarse:min-h-[44px]",
            on ? "bg-[var(--nav-active-bg)] font-semibold text-[var(--nav-active-fg)] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-[2px] before:bg-primary" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
          )}
        >
          <span className="min-w-0">{i.label}</span>
          <CountBadge n={n} tone="muted" />
        </Link>
      </li>
    );
  };

  /** The whole two-level menu (ADR-136): every area with its pages under it. */
  const tree = (big = false) =>
    nav.map((g) => {
      const items = groupEntries(g);
      const icon = ICONS[g.icon];
      const here = g === activeGroup;
      // An area with one page (Home) is one link.
      if (items.length <= 1) {
        const href = items[0]?.href ?? groupHref(g);
        const on = href === activeHref || (here && !activeHref);
        return (
          <li key={g.label} className="mb-0.5">
            <Link
              href={href}
              aria-current={on ? "page" : undefined}
              className={cx(
                "relative flex items-center gap-2.5 rounded-[6px] px-2.5 font-medium",
                big ? "min-h-[44px] text-[15px]" : "min-h-[34px] text-[14px] pointer-coarse:min-h-[44px]",
                on ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-[2px] before:bg-primary" : "text-fg hover:bg-surface-3",
              )}
            >
              <span className={on ? "text-primary-text" : "text-fg-2"} aria-hidden>{icon}</span>
              {g.label}
            </Link>
          </li>
        );
      }
      const open = !closed.includes(g.label) || here;
      const n = areaBadge(g);
      return (
        <li key={g.label} className="mt-1">
          <button
            type="button"
            onClick={() => toggleArea(g.label)}
            aria-expanded={open}
            aria-label={n ? `${g.label}, ${n} waiting` : undefined}
            className={cx("flex w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left font-semibold text-fg hover:bg-surface-3", big ? "min-h-[44px] text-[15px]" : "min-h-[34px] text-[14px] pointer-coarse:min-h-[44px]")}
            data-testid={`nav-area-${g.label}`}
          >
            <span className={here ? "text-primary-text" : "text-fg-2"} aria-hidden>{icon}</span>
            <span className="min-w-0 flex-1">{g.label}</span>
            <CountBadge n={n} />
            <ChevronDown size={14} aria-hidden className={cx("shrink-0 text-muted transition-transform", !open && "-rotate-90")} />
          </button>
          {open && <ul className="mb-1 mt-0.5 flex flex-col gap-px">{items.map((i) => entry(i, big))}</ul>}
        </li>
      );
    });

  /** The sidebar's icon-only column: one icon per area (its first page), the open area tinted. */
  const rail = nav.map((g) => {
    const here = g === activeGroup;
    const n = areaBadge(g);
    return (
      <li key={g.label}>
        <Link
          href={groupEntries(g)[0]?.href ?? groupHref(g)}
          title={g.label}
          aria-label={n ? `${g.label}, ${n} waiting` : g.label}
          aria-current={here ? "page" : undefined}
          className={cx("relative mx-auto grid size-10 place-items-center rounded-[6px]", here ? "bg-[var(--nav-active-bg)] text-primary-text" : "text-fg-2 hover:bg-surface-3 hover:text-fg")}
        >
          {ICONS[g.icon]}
          <CountBadge n={n} className="absolute -right-1 -top-1" />
        </Link>
      </li>
    );
  });

  const foot = (big = false, iconsOnly = false) => {
    const row = (href: string, label: string, icon: React.ReactNode, testId?: string) => {
      const on = pathname === href || pathname.startsWith(href + "/");
      return iconsOnly ? (
        <li key={href}>
          <Link href={href} title={label} aria-label={label} aria-current={on ? "page" : undefined} className={cx("mx-auto grid size-10 place-items-center rounded-[6px]", on ? "bg-[var(--nav-active-bg)] text-primary-text" : "text-fg-2 hover:bg-surface-3 hover:text-fg")} data-testid={testId}>
            {icon}
          </Link>
        </li>
      ) : (
        <li key={href}>
          <Link href={href} aria-current={on ? "page" : undefined} data-testid={testId} className={cx("relative flex items-center gap-2.5 rounded-[6px] px-2.5 font-medium", big ? "min-h-[44px] text-[15px]" : "min-h-[34px] text-[14px] pointer-coarse:min-h-[44px]", on ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-[2px] before:bg-primary" : "text-fg hover:bg-surface-3")}>
            <span className={on ? "text-primary-text" : "text-fg-2"} aria-hidden>{icon}</span>
            {label}
          </Link>
        </li>
      );
    };
    return (
      <ul className="flex flex-col gap-0.5">
        {hasSetup && row("/setup", "Set-up", <Settings size={16} />, big ? undefined : "sidebar-setup")}
        {hasSettings && row("/admin/settings", "Settings", <SlidersHorizontal size={16} />)}
        {row("/help", "Help", <HelpCircle size={16} />)}
      </ul>
    );
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[70] rounded-[6px] bg-surface px-3 py-2 text-[14px] font-medium text-fg shadow-[var(--shadow-pop)] focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to the page
      </a>
      <NavigationProgress />
      <RowClicks />

      {/* Sidebar from 1024 px (ADR-136). */}
      <aside ref={sideRef} aria-label="Menu" data-testid="sidebar" className="no-print fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-w)] flex-col border-r border-line bg-surface lg:flex">
        <div className={cx("flex h-14 shrink-0 items-center border-b border-line", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
          <Link href={homeHref} className="flex min-w-0 items-center gap-2.5 rounded-[6px]" aria-label="Bryel's Care home">
            <LogoMark className="size-7 shrink-0" />
            {!collapsed && <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg" aria-hidden>Bryel&apos;s Care</span>}
          </Link>
        </div>
        <nav aria-label="Main menu" className="min-h-0 flex-1 overflow-y-auto px-2 py-2" onKeyDown={arrowKeys} data-testid="side-menu">
          <ul className={cx("flex flex-col", collapsed && "gap-1")}>{collapsed ? rail : tree()}</ul>
        </nav>
        <div className="shrink-0 border-t border-line px-2 py-2" onKeyDown={arrowKeys}>
          {foot(false, collapsed)}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Show the menu names" : "Show icons only"}
            title={collapsed ? "Show the menu names" : "Show icons only"}
            className={cx("mt-1 flex min-h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] text-muted hover:bg-surface-3 hover:text-fg", collapsed && "justify-center px-0")}
            data-testid="sidebar-toggle"
          >
            {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden /> Icons only</>}
          </button>
        </div>
      </aside>

      <div className="pb-[76px] lg:pb-0 lg:pl-[var(--sidebar-w)]">
        {demo && <DemoBanner canReset={demo.canReset} sandbox={demo.sandbox} />}
        {/* Top bar, 56 px. */}
        <header className="no-print sticky top-0 z-30 border-b border-line bg-surface">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4 lg:px-6">
            {/* One menu button below 1024 px (B report B12, C report). Floor roles have none (their doors are below). */}
            {!floor && (
              <button className="grid size-10 shrink-0 place-items-center rounded-[6px] text-fg-2 hover:bg-surface-3 pointer-coarse:size-11 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu" data-testid="open-menu">
                <Menu size={20} />
              </button>
            )}
            <Link href={homeHref} className="grid min-h-11 min-w-11 shrink-0 place-items-center lg:hidden" aria-label="Bryel's Care home">
              <LogoMark className="size-8" />
            </Link>
            {/* Breadcrumb: Section / Page / record (ADR-136). */}
            <nav aria-label="You are here" className="hidden min-w-0 shrink lg:block" data-testid="breadcrumb">
              <ol className="flex min-w-0 items-center gap-1 text-[14px]">
                {trail.map((c, i) => {
                  const lastOne = i === trail.length - 1;
                  return (
                    <li key={i} className={cx("flex min-w-0 items-center gap-1", !lastOne && "shrink-0")}>
                      {i > 0 && <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />}
                      {"href" in c && c.href && !lastOne ? (
                        <Link href={c.href} className="truncate rounded-[4px] text-fg-2 hover:text-fg hover:underline">
                          {c.label}
                        </Link>
                      ) : (
                        <span className={cx("truncate", lastOne ? "font-medium text-fg" : "text-fg-2")} aria-current={lastOne ? "page" : undefined}>
                          {c.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
            {/* Search in the middle (round 5; ADR-136). ADR-126 "scan": the Scan button stands in its place. */}
            <div className="flex min-w-0 flex-1 items-center justify-center lg:px-4" data-testid="top-search">
              {search && <MasterSearchLauncher search={search} userId={user.id} keysOnly={scanFirst} />}
              {scanFirst && scanButton}
            </div>
            <div className="flex shrink-0 items-center gap-1">
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
                  <CountBadge n={approvalCount} className="absolute -right-0.5 -top-0.5" />
                </Link>
              )}
              {/* Messages: the bell (owner and manager: in "Needs me"). */}
              {!needsMeArea && (
                <Link href="/notifications" className={cx(topButton, pathname.startsWith("/notifications") && "text-primary-text")} aria-label={`Messages, ${unreadCount} unread`} title="Messages" data-testid="top-bar-messages">
                  <Bell size={18} aria-hidden />
                  <CountBadge n={unreadCount} className="absolute -right-0.5 -top-0.5" />
                </Link>
              )}
              {/* One "?" (floor roles have Help in the bottom bar instead). ADR-136: at every width. */}
              {loadHelp && !floor && (
                <div className="block">
                  <FrameHelp load={loadHelp} withLabel labelClass="hidden xl:inline" />
                </div>
              )}
              <details className="relative shrink-0" data-frame-menu ref={accountRef}>
                <summary className="ml-1 grid size-9 cursor-pointer list-none place-items-center rounded-full bg-surface-3 text-[13px] font-semibold text-fg-2 hover:bg-[var(--border)] pointer-coarse:size-11 [&::-webkit-details-marker]:hidden" aria-label="Your account, help and set-up" data-testid="account-menu">
                  {initials}
                </summary>
                <div className="absolute right-0 top-11 z-40 w-64 max-w-[calc(100vw-32px)] rounded-[8px] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]">
                  <div className="px-2.5 py-2">
                    <p className="font-semibold text-fg">{user.name}</p>
                    <p className="text-[12px] text-muted">{user.roles}</p>
                    <p className="mt-0.5 text-[12px] text-muted">Site: {site?.name}</p>
                  </div>
                  <ul className="border-t border-line py-1">
                    <li><Link href="/account" className="flex min-h-[36px] items-center rounded-[6px] px-2.5 text-[14px] text-fg hover:bg-surface-3 pointer-coarse:min-h-[44px]">My account and devices</Link></li>
                    <li><Link href="/help" className="flex min-h-[36px] items-center rounded-[6px] px-2.5 text-[14px] text-fg hover:bg-surface-3 pointer-coarse:min-h-[44px]">Help</Link></li>
                    {hasSetup && <li><Link href="/setup" className="flex min-h-[36px] items-center rounded-[6px] px-2.5 text-[14px] text-fg hover:bg-surface-3 pointer-coarse:min-h-[44px]" data-testid="account-setup">Set-up</Link></li>}
                    <li className="lg:hidden">
                      <button type="button" onClick={() => { accountRef.current?.removeAttribute("open"); setDrawer(true); }} className="flex min-h-[44px] w-full items-center rounded-[6px] px-2.5 text-left text-[14px] text-fg hover:bg-surface-3" data-testid="account-all-screens">
                        All screens
                      </button>
                    </li>
                    {demo?.canReset && <li><Link href="/admin/demo" className="flex min-h-[36px] items-center rounded-[6px] px-2.5 text-[14px] text-fg hover:bg-surface-3 pointer-coarse:min-h-[44px]">Reset demo data</Link></li>}
                  </ul>
                  <div className="border-t border-line pt-1">
                    <SignOutButton signOut={signOut} variant="menu" />
                  </div>
                </div>
              </details>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-6" data-frame-help={loadHelp && !floor ? "on" : undefined}>
          <DeletedNotice pathname={pathname} />
          {/* ADR-132 §6: after a save the record opens at the top with its success message. */}
          <SavedLanding />
          {children}
        </main>
      </div>

      {/* Bottom bar below 1024 px: the role's doors, never a second menu button. */}
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-[560px] justify-around">
          {tabs.map((t) => {
            const active = t.href === activeTab;
            const n = tabBadge(t);
            return (
              <li key={t.href} className="min-w-0 flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} aria-label={n ? withCount(t.label, n) : undefined} className={cx("flex min-h-[56px] flex-col items-center gap-0.5 px-1 py-2 text-center text-[11px] font-medium leading-tight", active ? "text-primary-text" : "text-fg-2")}>
                  <span className={cx("relative grid h-7 w-12 place-items-center rounded-[6px]", active && "bg-[var(--nav-active-bg)]")}>
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

      {/* Drawer below 1024 px (☰) or "All screens" in the avatar menu: the same tree as the sidebar. */}
      {drawer && (
        <div className="fixed inset-0 z-50" data-testid="drawer">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[320px] max-w-[86vw] flex-col bg-surface shadow-xl" aria-label="Menu" role="dialog" aria-modal="true">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <Logo className="h-7 w-auto" />
              <button className="grid size-11 place-items-center rounded-[6px] text-fg-2 hover:bg-surface-3" onClick={() => setDrawer(false)} aria-label="Close menu" autoFocus><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onKeyDown={arrowKeys}>
              {sites.length > 1 && <div className="mb-3">{siteSwitcher(true)}</div>}
              <div className="mb-3">
                <DrawerSync userId={user.id} />
              </div>
              <ul className="flex flex-col">{tree(true)}</ul>
              <div className="mt-3 border-t border-line pt-3">{foot(true)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
              <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-[12px] font-semibold text-fg-2" aria-hidden>{initials}</span>
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
