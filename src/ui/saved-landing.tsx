"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * After a save, the record opens at the top with its success message in view (ADR-132 §6; C report B23: "Save a new
 * customer with Enter" opened the new customer scrolled down, title hidden; the browser walk found the same after
 * "Save the request"). A server action that redirects keeps the scroll position of the form it came from. So:
 * - a new page (another path) that was not reached with Back/Forward and has no #anchor starts at the top;
 * - the same page reloaded with a "just saved" word in the URL (one of SAVED_PARAMS) starts at the top too;
 * and the first status message (the green banner) gets the focus, so a screen reader reads it. Back/forward keeps the
 * browser's own scroll; anchors are left alone; a change of filters on the same page does not move it.
 */
export const SAVED_PARAMS = ["created", "saved", "sent", "done", "opened", "placed", "changed", "edited", "logged", "merged", "moved", "posted", "reversed", "reprinted", "repacked", "ok"] as const;

export function savedLanding(search: string, hash: string): boolean {
  if (hash && hash !== "#") return false;
  const q = new URLSearchParams(search);
  return SAVED_PARAMS.some((p) => q.has(p));
}

/** Whether to start at the top after a navigation (pure; unit-tested). */
export function landAtTop(prev: { path: string; search: string } | null, next: { path: string; search: string; hash: string }, backOrForward: boolean): boolean {
  if (!prev || backOrForward) return false;
  if (next.hash && next.hash !== "#") return false;
  if (prev.path !== next.path) return true;
  return prev.search !== next.search && savedLanding(next.search, next.hash);
}

let popped = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (popped = true));

export function SavedLanding() {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const prev = useRef<{ path: string; search: string } | null>(null);
  useEffect(() => {
    const next = { path: pathname, search, hash: window.location.hash };
    const go = landAtTop(prev.current, next, popped);
    popped = false;
    prev.current = { path: pathname, search };
    if (!go) return;
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
    // Only after a save: the green banner takes the focus (never on an ordinary page visit).
    const msg = savedLanding(search, next.hash) ? document.querySelector<HTMLElement>("main [role=status]") : null;
    if (msg) {
      if (!msg.hasAttribute("tabindex")) msg.setAttribute("tabindex", "-1");
      msg.focus({ preventScroll: true });
    }
  }, [pathname, search]);
  return null;
}
