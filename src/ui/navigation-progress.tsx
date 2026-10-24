"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Gives up showing progress after this long (a link that did not navigate, a failed request). */
const SAFETY_MS = 15_000;

/** True when a click on this anchor starts a client-side navigation to another URL of the app. */
function startsNavigation(e: MouseEvent): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return false;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download") || a.dataset.noProgress !== undefined) return false;
  const to = new URL(a.href, window.location.href);
  if (to.origin !== window.location.origin) return false;
  // API links download files; print pages open in their own layout; same URL (or #hash) does not navigate.
  if (to.pathname.startsWith("/api/")) return false;
  return to.pathname !== window.location.pathname || to.search !== window.location.search;
}

/**
 * Navigation feedback for the authenticated app (ADR-043, docs/ux-system.md §6 "Loading"): while a
 * client navigation is in flight, a thin progress bar runs along the top edge of the screen, the
 * previous page is held at 60 % opacity after 300 ms (CSS on `html[data-navigating]`) and screen
 * readers hear "Loading page". It replaces route `loading.tsx` skeletons, which must not wrap
 * pages with in-place actions. Form submissions show their own pending state (SubmitButton).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  // The new URL is committed: the navigation is over.
  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (startsNavigation(e)) setPending(true);
    };
    // Back/forward restores from the router cache without a request; only link clicks are tracked.
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!pending) {
      root.removeAttribute("data-navigating");
      return;
    }
    root.setAttribute("data-navigating", "");
    const t = window.setTimeout(() => setPending(false), SAFETY_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  return (
    <>
      <span className="sr-only" aria-live="polite">
        {pending ? "Loading page…" : ""}
      </span>
      {pending && (
        <div className="nav-progress no-print" role="progressbar" aria-label="Loading page" aria-busy="true">
          <span />
        </div>
      )}
    </>
  );
}
