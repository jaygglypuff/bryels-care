"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanLine, Search, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass, cx } from "@/ui/core";

/**
 * One search box for the stock list (owner review 2026-10-30): filters as you type (short pause) or on
 * Enter. Works without JavaScript as a plain GET form. The words are matched on the server
 * (stockByItem): item name, code, lot number or supplier lot, every word must match.
 */
export function StockSearch({ defaultQ, keep }: { defaultQ: string; keep: Record<string, string | undefined> }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQ);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(defaultQ);

  const go = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const v = value.trim();
    if (v === last.current.trim()) return;
    last.current = v;
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(keep)) if (val) p.set(k, val);
    if (v) p.set("q", v);
    const qs = p.toString();
    start(() => router.replace(`/inventory${qs ? `?${qs}` : ""}`, { scroll: false }));
  };

  // A tab or chip link changed the words (e.g. "All stock" clears them): show what the page shows.
  useEffect(() => {
    if (defaultQ.trim() !== last.current.trim()) {
      last.current = defaultQ;
      setQ(defaultQ);
    }
  }, [defaultQ]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <form
      method="get"
      action="/inventory"
      role="search"
      className="flex items-stretch gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go(q);
      }}
    >
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label htmlFor="stock-q" className="sr-only">Search stock</label>
      <div className="relative min-w-0 flex-1">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id="stock-q"
          name="q"
          type="search"
          value={q}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Name or lot number…"
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => go(v), 400);
          }}
          className={cx(
            "h-[48px] w-full rounded-full border border-line bg-surface pl-10 pr-10 text-[15px] text-fg outline-none placeholder:text-muted focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/30 [&::-webkit-search-cancel-button]:hidden",
            pending && "opacity-70",
          )}
          aria-busy={pending}
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-1 top-1/2 inline-flex size-[44px] -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-fg"
            onClick={() => {
              setQ("");
              go("");
              document.getElementById("stock-q")?.focus();
            }}
          >
            <X size={18} aria-hidden />
          </button>
        )}
      </div>
      <Link href="/inventory/scan" className={cx(buttonClass("cta"), "h-[48px] shrink-0 px-4")}>
        <ScanLine size={18} aria-hidden />
        Scan
      </Link>
    </form>
  );
}
