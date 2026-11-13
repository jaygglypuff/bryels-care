"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * After a save, the record opens at the top with its success message in view (ADR-132 §6; C report B23: "Save a new
 * customer with Enter" opened the new customer scrolled down, title hidden). A server action that redirects keeps the
 * scroll position of the form it came from; when the new URL says "just saved" (one of SAVED_PARAMS) and has no
 * #anchor, the page scrolls to the top once and the first status message (the green banner) gets the focus, so a
 * screen reader reads it too. Back/forward and anchors are left alone.
 */
export const SAVED_PARAMS = ["created", "saved", "done", "opened", "placed", "changed", "edited", "logged", "merged", "moved", "posted", "reversed", "reprinted", "repacked", "ok"] as const;

export function savedLanding(search: string, hash: string): boolean {
  if (hash && hash !== "#") return false;
  const q = new URLSearchParams(search);
  return SAVED_PARAMS.some((p) => q.has(p));
}

export function SavedLanding() {
  const pathname = usePathname();
  const params = useSearchParams();
  const done = useRef<string | null>(null);
  const key = `${pathname}?${params.toString()}`;
  useEffect(() => {
    if (done.current === key) return;
    done.current = key;
    if (!savedLanding(params.toString(), window.location.hash)) return;
    window.scrollTo({ top: 0 });
    const msg = document.querySelector<HTMLElement>("main [role=status]");
    if (msg) {
      if (!msg.hasAttribute("tabindex")) msg.setAttribute("tabindex", "-1");
      msg.focus({ preventScroll: true });
    }
  }, [key, params]);
  return null;
}
