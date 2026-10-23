"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, Boxes, ClipboardList, Clock, Database, Factory, FlaskConical, GitBranch, Home, LogOut, Menu, PackagePlus, ScanLine,
  ScrollText, Settings, ShieldCheck, ShoppingCart, Truck, X,
} from "lucide-react";
import type { NavGroup, QuickAction } from "./nav";
import { cx } from "@/ui/core";
import { Logo, LogoMark } from "@/ui/brand";

const ICONS: Record<string, React.ReactNode> = {
  home: <Home size={18} />, boxes: <Boxes size={18} />, factory: <Factory size={18} />, shield: <ShieldCheck size={18} />,
  truck: <Truck size={18} />, database: <Database size={18} />, settings: <Settings size={18} />, clock: <Clock size={18} />,
  scan: <ScanLine size={19} />, receive: <PackagePlus size={19} />, batch: <FlaskConical size={19} />, qa: <ClipboardList size={19} />,
  order: <ShoppingCart size={19} />, trace: <GitBranch size={19} />, audit: <ScrollText size={19} />,
};

type Props = {
  nav: NavGroup[];
  quickActions: QuickAction[];
  user: { name: string; roles: string };
  sites: { id: string; code: string; name: string }[];
  currentSiteId: string;
  qaCount: number | null;
  switchSite: (fd: FormData) => Promise<void>;
  signOut: () => Promise<void>;
  children: React.ReactNode;
};

function matchLen(pathname: string, href: string) {
  if (href === "#") return -1;
  if (pathname === href) return href.length + 1000;
  if (pathname.startsWith(href + "/")) return href.length;
  return -1;
}

export function Shell({ nav, quickActions, user, sites, currentSiteId, qaCount, switchSite, signOut, children }: Props) {
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
  const allowedHrefs = new Set(real.flatMap((g) => g.items.filter((i) => !i.planned).map((i) => i.href)));
  const groupHref = (g: NavGroup) => g.items.find((i) => !i.planned)?.href ?? "#";
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const site = sites.find((s) => s.id === currentSiteId);

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
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
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
            <div className="hidden sm:block">{siteSwitcher}</div>
            <Link href="/inventory/scan" className="hidden size-10 place-items-center rounded-full bg-surface text-fg-2 shadow-[var(--shadow-card)] hover:text-fg sm:grid" aria-label="Scan or search" title="Scan or search">
              <ScanLine size={18} />
            </Link>
            {qaCount !== null && (
            <Link href="/quality" className="relative grid size-10 place-items-center rounded-full bg-surface text-fg-2 shadow-[var(--shadow-card)] hover:text-fg" aria-label={`QA queue, ${qaCount} open`} title="QA queue">
              <Bell size={18} />
              {qaCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#c62828] px-1 text-[10px] font-semibold leading-[18px] text-white">{qaCount}</span>
              )}
            </Link>
            )}
            <details className="relative">
              <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-lime-100 text-[13px] font-semibold text-brand ring-2 ring-white" style={{ background: "var(--lime-200)", color: "var(--brand-800)" }} aria-label="Account">
                {initials}
              </summary>
              <div className="absolute right-0 top-12 z-40 w-64 rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
                <p className="font-semibold text-fg">{user.name}</p>
                <p className="text-[12px] text-muted">{user.roles}</p>
                <p className="mt-2 text-[12px] text-muted">Site: {site?.code} · {site?.name}</p>
                <form action={signOut} className="mt-3 border-t border-line pt-3">
                  <button className="flex items-center gap-1.5 text-[13px] font-medium text-primary-text hover:underline"><LogOut size={14} /> Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </div>
        {/* Sub-page tabs for the active module */}
        {activeGroup && activeGroup.items.filter((i) => !i.planned).length > 1 && (
          <div className="mx-auto hidden max-w-[1480px] px-4 pb-3 sm:px-6 lg:block lg:pl-[92px]">
            <ul className="scroll-x-hidden flex gap-1.5 overflow-x-auto">
              {activeGroup.items.filter((i) => !i.planned).map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={i.href === activeHref ? "page" : undefined}
                    className={cx(
                      "block whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                      i.href === activeHref ? "border-transparent bg-brand text-white" : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
                    )}
                    style={i.href === activeHref ? { background: "var(--brand-600)" } : undefined}
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
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
                  title={q.label}
                  aria-label={q.label}
                  className={cx("grid size-11 place-items-center rounded-full transition-colors", active ? "text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}
                  style={active ? { background: "var(--brand-600)" } : undefined}
                >
                  {ICONS[q.icon]}
                </Link>
              );
            })}
          </div>
          <form action={signOut}>
            <button className="mt-2 grid size-11 place-items-center rounded-full bg-surface text-fg-2 shadow-[var(--shadow-card)] hover:text-fg" title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </form>
        </aside>
        <main className="min-w-0 flex-1 py-5 sm:py-7">{children}</main>
      </div>

      {/* Phone bottom tab bar */}
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="mx-auto flex max-w-[560px] justify-around">
          {[
            { label: "Home", href: "/dashboard", icon: <Home size={20} /> },
            { label: "Scan", href: "/inventory/scan", icon: <ScanLine size={20} /> },
            { label: "Batches", href: "/production", icon: <Factory size={20} /> },
            { label: "QA", href: "/quality", icon: <ShieldCheck size={20} /> },
            { label: "Orders", href: "/sales", icon: <Truck size={20} /> },
          ].filter((t) => allowedHrefs.has(t.href)).map((t) => {
            const active = matchLen(pathname, t.href) >= 0;
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-primary-text" : "text-muted")}>
                  <span className={cx("grid h-7 w-12 place-items-center rounded-full", active && "bg-[var(--lime-100)]")}>{t.icon}</span>
                  {t.label}
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
            <div className="mb-4 sm:hidden">{siteSwitcher}</div>
            {real.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{ICONS[g.icon]} {g.label}</p>
                <ul>
                  {g.items.filter((i) => !i.planned).map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className={cx("block rounded-[12px] px-3 py-2.5 text-[14px]", i.href === activeHref ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2")}>{i.label}</Link>
                    </li>
                  ))}
                </ul>
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
