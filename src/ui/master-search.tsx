"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Banknote, Box, Boxes, Clock, Cog, FileText, FlaskConical, Factory, LayoutGrid, MapPin, Package, Search, ShieldCheck, ShoppingCart, Truck, UserRound, Wrench, X, ScanLine, Building2, Layers,
} from "lucide-react";
import type { MasterSearchResponse } from "@/app/(app)/search-actions";
import type { HitIcon } from "@/modules/scan";
import { cx } from "./core";

/**
 * Master search (owner request 2026-11-08): one box for screens, record numbers and names. Used in the top-bar dialog
 * (Ctrl/⌘+K, "/") and on the Scan or search screen. Results come from a server action as you type (200 ms pause),
 * grouped, keyboard operable (↑ ↓ Enter, Esc), each row: icon, name, number small and grey, one plain line.
 * An empty box shows this person's recent searches and records (kept on this device only) and common screens.
 * The server decides what may be shown; this component only displays it.
 */

export type SearchFn = (q: string) => Promise<MasterSearchResponse>;

const DEBOUNCE_MS = 200;
const RECENT_MAX = 6;
/** A scanned or typed label (ADR-017): opened as a scan card on the Scan or search screen. */
const LABEL = /^BC:[A-Z]{3}:/i;

type RowIcon = HitIcon | "screen" | "recent";
type Row = { key: string; icon: RowIcon; name: string; number?: string; detail?: string; href: string; exact?: boolean; query?: string };
type Section = { label: string; rows: Row[] };
type Recent = { q: string[]; r: { name: string; number?: string; href: string; icon: RowIcon }[] };

const ICON: Record<RowIcon, React.ReactNode> = {
  money: <Banknote size={18} />, buying: <ShoppingCart size={18} />, sales: <ShoppingCart size={18} />, delivery: <Truck size={18} />,
  production: <Factory size={18} />, lot: <Layers size={18} />, box: <Box size={18} />, stock: <Boxes size={18} />, quality: <ShieldCheck size={18} />,
  repair: <Wrench size={18} />, document: <FileText size={18} />, material: <FlaskConical size={18} />, product: <Package size={18} />,
  customer: <UserRound size={18} />, supplier: <Building2 size={18} />, shelf: <MapPin size={18} />, equipment: <Cog size={18} />,
  recipe: <FlaskConical size={18} />, screen: <LayoutGrid size={18} />, recent: <Clock size={18} />,
};

const storeKey = (userId: string) => `bc.search.recent.${userId}`;

function readRecent(userId: string): Recent {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(userId)) ?? "null") as Recent | null;
    return v && Array.isArray(v.q) && Array.isArray(v.r) ? v : { q: [], r: [] };
  } catch {
    return { q: [], r: [] };
  }
}

function writeRecent(userId: string, next: Recent) {
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(next));
  } catch {
    /* private mode or full: recent items are a convenience only */
  }
}

/** Remembers what was opened (and the words that found it) for the empty box next time. */
function remember(userId: string, query: string, row: Row) {
  const cur = readRecent(userId);
  const q = query.trim() ? [query.trim(), ...cur.q.filter((x) => x.toLowerCase() !== query.trim().toLowerCase())].slice(0, RECENT_MAX) : cur.q;
  const r = row.icon === "recent" ? cur.r : [{ name: row.name, number: row.number, href: row.href, icon: row.icon }, ...cur.r.filter((x) => x.href !== row.href)].slice(0, RECENT_MAX);
  writeRecent(userId, { q, r });
}

function sectionsFrom(res: MasterSearchResponse | null, recent: Recent): Section[] {
  if (!res) return [];
  if (!res.query) {
    const out: Section[] = [];
    if (recent.q.length) out.push({ label: "Recent searches", rows: recent.q.map((q, i) => ({ key: `q${i}`, icon: "recent", name: q, href: "", query: q })) });
    if (recent.r.length) out.push({ label: "Recently opened", rows: recent.r.map((r, i) => ({ key: `r${i}`, ...r })) });
    if (res.common.length) out.push({ label: "Common screens", rows: res.common.map((s) => ({ key: `c${s.href}`, icon: "screen", name: s.label, detail: s.where, href: s.href })) });
    return out;
  }
  const out: Section[] = [];
  const numbers = res.groups.find((g) => g.key === "numbers");
  const toRow = (h: MasterSearchResponse["groups"][number]["hits"][number], g: string): Row => ({ key: `${g}:${h.type}:${h.href}:${h.number}`, icon: h.icon, name: h.name, number: h.number, detail: h.detail, href: h.href, exact: h.exact });
  // An exact number comes before everything; screens next; then the rest.
  if (numbers?.hits.some((h) => h.exact)) out.push({ label: numbers.label, rows: numbers.hits.map((h) => toRow(h, "n")) });
  if (res.screens.length) out.push({ label: "Screens", rows: res.screens.map((s) => ({ key: `s${s.href}`, icon: "screen", name: s.label, detail: s.where, href: s.href })) });
  for (const g of res.groups) if (g.key !== "numbers" || !numbers?.hits.some((h) => h.exact)) out.push({ label: g.label, rows: g.hits.map((h) => toRow(h, g.key)) });
  return out;
}

export function MasterSearchPanel({
  search,
  userId,
  variant,
  autoFocus = false,
  onClose,
  onLabel,
  initialQuery = "",
}: {
  search: SearchFn;
  userId: string;
  variant: "dialog" | "page";
  autoFocus?: boolean;
  /** Dialog: Esc and choosing a row close it. */
  onClose?: () => void;
  /** A label (BC:…) was entered: show its scan card. Without it, the Scan or search screen opens with the label. */
  onLabel?: (raw: string) => void;
  initialQuery?: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [q, setQ] = useState(initialQuery);
  const [res, setRes] = useState<MasterSearchResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent>({ q: [], r: [] });
  const [offline, setOffline] = useState(false);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setRecent(readRecent(userId)), [userId]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // As you type: wait 200 ms after the last key, drop answers to older text.
  useEffect(() => {
    const text = q.trim();
    const n = ++seq.current;
    if (text && LABEL.test(text)) {
      setPending(false);
      return;
    }
    const t = setTimeout(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setOffline(true);
        return;
      }
      setOffline(false);
      setPending(true);
      try {
        const r = await search(text);
        if (n === seq.current) {
          setRes(r);
          setActive(0);
        }
      } catch {
        if (n === seq.current) setRes({ query: text, screens: [], groups: [], exactHref: null, common: [], error: "The search did not work just now. Check your connection and try again." });
      } finally {
        if (n === seq.current) setPending(false);
      }
    }, text ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [q, search]);

  // A label (BC:…) is not searched: the old results would only distract.
  const sections = useMemo(() => (LABEL.test(q.trim()) ? [] : sectionsFrom(res, recent)), [q, res, recent]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const optionId = (i: number) => `${ids}-opt-${i}`;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = useCallback(
    (row: Row) => {
      if (row.query !== undefined) {
        setQ(row.query);
        inputRef.current?.focus();
        return;
      }
      remember(userId, q, row);
      setRecent(readRecent(userId));
      onClose?.();
      router.push(row.href);
    },
    [onClose, q, router, userId],
  );

  const label = (raw: string) => {
    if (onLabel) onLabel(raw);
    else {
      onClose?.();
      router.push(`/inventory/scan?code=${encodeURIComponent(raw)}`);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = q.trim();
      if (LABEL.test(text)) return label(text);
      // Results may still be on their way for the last keys: wait for the answer to the text as typed.
      if (res && res.query === text && rows[active]) choose(rows[active]);
      else if (text) {
        const n = seq.current;
        void search(text).then((r) => {
          if (n !== seq.current) return;
          setRes(r);
          const first = sectionsFrom(r, recent).flatMap((s) => s.rows)[0];
          if (first) choose(first);
        });
      }
    } else if (e.key === "Escape") {
      if (variant === "dialog") onClose?.();
      else if (q) setQ("");
    }
  };

  const text = q.trim();
  const shown = res && res.query === text;
  const nothing = !!text && !!shown && !pending && rows.length === 0 && !res?.error;
  let index = -1;

  return (
    <div className={cx("flex min-h-0 flex-col", variant === "dialog" && "max-h-[min(80dvh,640px)]")} data-testid="master-search">
      <div className={cx("flex items-center gap-2 border-line px-3", variant === "dialog" ? "border-b" : "rounded-[14px] border bg-surface shadow-[var(--shadow-card)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring)]")}>
        <Search size={18} aria-hidden className="shrink-0 text-muted" />
        <label htmlFor={`${ids}-input`} className="sr-only">Search anything</label>
        <input
          ref={inputRef}
          id={`${ids}-input`}
          data-testid="master-search-input"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={`${ids}-list`}
          aria-activedescendant={rows.length ? optionId(active) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search anything — a screen, a name or a number"
          // The box around the input shows the focus (page) or the open dialog does; the global ring would sit inside it.
          style={{ outline: "none" }}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-muted focus-visible:outline-none"
        />
        {pending && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-primary" aria-label="Searching" />}
        {q && (
          <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-fg" aria-label="Clear the search">
            <X size={16} aria-hidden />
          </button>
        )}
        {variant === "dialog" && (
          <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted sm:inline">Esc</kbd>
        )}
      </div>

      <div ref={listRef} id={`${ids}-list`} role="listbox" aria-label="Search results" aria-busy={pending} className={cx("min-h-0 overflow-y-auto", variant === "dialog" ? "px-2 py-2" : "mt-3 space-y-3")}>
        {offline && <p role="alert" className="m-2 rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">You&apos;re offline. Search needs a connection; try again when you&apos;re back online.</p>}
        {res?.error && shown && <p role="alert" className="m-2 rounded-[10px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[var(--bad-fg)]">{res.error}</p>}
        {LABEL.test(text) && <p className="m-2 px-1 text-[13px] text-fg-2">This is a label. Press Enter to see what it is.</p>}
        {!res && !offline && <div className="m-2 h-24 animate-pulse rounded-[14px] bg-surface-2" aria-label="Loading" />}
        {nothing && (
          <p className="m-2 px-1 py-3 text-[14px] text-fg-2" role="status">
            Nothing found for “{text}”. Try part of a name, or the last digits of the number (for example 00012).
          </p>
        )}
        {sections.map((s) => (
          <div key={s.label} role="group" aria-labelledby={`${ids}-${s.label}`} className={cx(variant === "page" && "rounded-[14px] bg-surface p-2 shadow-[var(--shadow-card)]")}>
            <div id={`${ids}-${s.label}`} className="px-2 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{s.label}</div>
            {s.rows.map((r) => {
              index += 1;
              const i = index;
              const isActive = i === active;
              const body = (
                <>
                  <span className={cx("grid size-9 shrink-0 place-items-center rounded-full", isActive ? "bg-white/15" : "bg-surface-2 text-fg-2")} aria-hidden>{ICON[r.icon]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[14px] font-medium">{r.name}</span>
                      {r.number && <span className={cx("shrink-0 font-mono text-[12px]", isActive ? "text-white/80" : "text-muted")}>{r.number}</span>}
                    </span>
                    {r.detail && <span className={cx("block truncate text-[12px]", isActive ? "text-white/85" : "text-fg-2")}>{r.detail}</span>}
                  </span>
                  {r.exact && <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", isActive ? "bg-white/20" : "bg-[var(--ok-bg)] text-[var(--ok-fg)]")}>This number</span>}
                </>
              );
              const cls = cx("flex min-h-[52px] w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left", isActive ? "bg-cta text-white" : "text-fg hover:bg-surface-2");
              return r.query !== undefined ? (
                <button key={r.key} type="button" id={optionId(i)} role="option" aria-selected={isActive} data-index={i} className={cls} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                  {body}
                </button>
              ) : (
                <Link
                  key={r.key}
                  href={r.href}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isActive}
                  data-index={i}
                  className={cls}
                  onMouseEnter={() => setActive(i)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // a new tab keeps the search open
                    e.preventDefault();
                    choose(r);
                  }}
                >
                  {body}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      {variant === "dialog" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-muted">
          <span>↑ ↓ to choose · Enter to open · Esc to close</span>
          <Link href="/inventory/scan" onClick={() => onClose?.()} className="inline-flex min-h-[34px] items-center gap-1 rounded-full px-2 font-medium text-primary-text hover:underline">
            <ScanLine size={14} aria-hidden /> Scan a label
          </Link>
        </div>
      )}
    </div>
  );
}

/** Whether a key press happens while typing somewhere (then "/" types a slash, not opening the search). */
function typingIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * The top-bar search box (from 1024 px) and the Ctrl/⌘+K and "/" shortcuts (every width). Opens the search in a
 * dialog over the page. On phones the Scan button in the top bar opens the Scan or search screen instead.
 */
export function MasterSearchLauncher({ search, userId }: { search: SearchFn; userId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        data-testid="master-search-open"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K /"
        aria-label="Search anything — a screen, a name or a number"
        title="Search anything (Ctrl+K or /)"
        className="hidden h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-left text-[13px] text-muted shadow-[var(--shadow-card)] hover:text-fg lg:flex lg:w-[clamp(240px,30vw,360px)] xl:w-auto xl:min-w-11 xl:justify-center xl:px-3 xl:text-fg-2"
      >
        <Search size={16} aria-hidden className="shrink-0" />
        {/* From 1280 px the five destinations sit in the same bar and were measured full (live check 2026-11-06): the
            box becomes a round search button, narrower than the Scan button it replaces there; the words are in the dialog. */}
        <span className="min-w-0 flex-1 truncate xl:hidden">Search anything — a screen, a name or a number</span>
        <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px] lg:inline xl:hidden">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-0 sm:p-4 sm:pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-label="Search anything" className="w-full max-w-2xl overflow-hidden bg-surface shadow-2xl sm:rounded-[18px]">
            <MasterSearchPanel search={search} userId={userId} variant="dialog" autoFocus onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}
