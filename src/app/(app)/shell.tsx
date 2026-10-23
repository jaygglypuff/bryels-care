"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Boxes, ChevronDown, Clock, Database, Factory, Home, LogOut, Menu, Settings, ShieldCheck, Truck, X } from "lucide-react";
import type { NavGroup } from "./nav";
import { cx } from "@/ui/core";

const ICONS: Record<string, React.ReactNode> = {
  home: <Home size={18} />,
  boxes: <Boxes size={18} />,
  factory: <Factory size={18} />,
  shield: <ShieldCheck size={18} />,
  truck: <Truck size={18} />,
  database: <Database size={18} />,
  settings: <Settings size={18} />,
  clock: <Clock size={18} />,
};

type Props = {
  nav: NavGroup[];
  user: { name: string; roles: string };
  sites: { id: string; code: string; name: string }[];
  currentSiteId: string;
  switchSite: (fd: FormData) => Promise<void>;
  signOut: () => Promise<void>;
  children: React.ReactNode;
};

export function Shell({ nav, user, sites, currentSiteId, switchSite, signOut, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Highlight only the most specific matching item (e.g. /inventory/receive/… marks "Receive materials", not also "Lots & stock").
  const matches = (href: string) => href !== "#" && (pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/")));
  const activeHref = nav
    .flatMap((g) => g.items.map((i) => i.href))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-4">
      <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2" onClick={() => setOpen(false)}>
        <span className="grid size-8 place-items-center rounded-[9px] bg-primary text-[13px] font-bold text-white">BC</span>
        <span className="font-semibold text-fg">Bryel&apos;s Care</span>
      </Link>
      {nav.map((g) => (
        <details key={g.label} open={g.items.some((i) => isActive(i.href)) || g.label === "Home"} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[14px] font-medium text-fg-2 hover:bg-surface-2">
            {ICONS[g.icon]}
            <span className="flex-1">{g.label}</span>
            <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mb-1 ml-[30px] mt-0.5 flex flex-col gap-0.5">
            {g.items.map((i) =>
              i.planned ? (
                <li key={i.label} className="flex items-center justify-between rounded-[9px] px-3 py-1.5 text-[13px] text-muted" aria-disabled="true">
                  {i.label}
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold uppercase tracking-wide">{i.planned}</span>
                </li>
              ) : (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className={cx(
                      "block rounded-[9px] px-3 py-1.5 text-[13px]",
                      isActive(i.href) ? "bg-cta font-medium text-white" : "text-fg-2 hover:bg-surface-2",
                    )}
                  >
                    {i.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </details>
      ))}
      <div className="mt-auto border-t border-line px-2 pt-3">
        <p className="text-[13px] font-medium text-fg">{user.name}</p>
        <p className="text-[12px] text-muted">{user.roles}</p>
        <form action={signOut} className="mt-2">
          <button className="flex items-center gap-1.5 text-[13px] text-primary-text hover:underline">
            <LogOut size={14} /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6">
          <button className="grid size-10 place-items-center rounded-[10px] border border-line lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <form action={switchSite} className="flex items-center gap-2">
            <input type="hidden" name="returnTo" value={pathname} />
            <label htmlFor="site-switch" className="sr-only">
              Site
            </label>
            <select
              id="site-switch"
              name="siteId"
              defaultValue={currentSiteId}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="min-h-[40px] rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </form>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <Link href="/inventory/scan" className="rounded-full border border-line px-3 py-2 text-[13px] text-fg-2 hover:bg-surface-2">
              Scan or search lot, batch, order…
            </Link>
          </div>
          <span className="ml-auto grid size-9 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-text sm:ml-2" title={user.name}>
            {user.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
