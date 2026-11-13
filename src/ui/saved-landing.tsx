"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * After a save, the record opens at the top with its success message in view (ADR-132 §6; C report B23: "Save a new
 * customer with Enter" opened the new customer scrolled down, title hidden; the browser walk found the same after
 * "Save the request", a new bill and a new price offer). A server action that redirects keeps the scroll position of
 * the form it came from. So a new page (another path) that was not reached with Back/Forward and has no #anchor starts
 * at the top; when its URL says "just saved" (one of SAVED_PARAMS) the first status message (the green banner) also
 * gets the focus, so a screen reader reads it. Back/forward keeps the browser's own scroll; anchors are left alone; a
 * change of filters on the same page does not move it. No `useSearchParams` (it would need a loading boundary, which
 * the in-place actions rule forbids, ADR-043): the query is read from the window when the path changes.
 */
export const SAVED_PARAMS = ["created", "saved", "sent", "done", "opened", "placed", "changed", "edited", "logged", "merged", "moved", "posted", "reversed", "reprinted", "repacked", "ok"] as const;

export function savedLanding(search: string, hash: string): boolean {
  if (hash && hash !== "#") return false;
  const q = new URLSearchParams(search);
  return SAVED_PARAMS.some((p) => q.has(p));
}

/** Whether to start at the top after the path changed (pure; unit-tested). */
export function landAtTop(prevPath: string | null, next: { path: string; hash: string }, backOrForward: boolean): boolean {
  if (prevPath === null || backOrForward) return false;
  if (next.hash && next.hash !== "#") return false;
  return prevPath !== next.path;
}

let popped = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (popped = true));

export function SavedLanding() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const { hash, search } = window.location;
    const go = landAtTop(prev.current, { path: pathname, hash }, popped);
    popped = false;
    prev.current = pathname;
    if (!go) return;
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
    // Only after a save: the green banner takes the focus (never on an ordinary page visit).
    const msg = savedLanding(search, hash) ? document.querySelector<HTMLElement>("main [role=status]") : null;
    if (msg) {
      if (!msg.hasAttribute("tabindex")) msg.setAttribute("tabindex", "-1");
      msg.focus({ preventScroll: true });
    }
  }, [pathname]);
  return null;
}
