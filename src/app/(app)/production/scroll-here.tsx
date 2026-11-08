"use client";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Round 5 B5: after Finish the order page opened scrolled to the bottom (the daily log form), so the success message
 * was off screen. This wrapper brings its content into view once, at the top of the screen, and reads it out.
 */
export function ScrollHere({ children, testId }: { children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: "start" });
      el.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="scroll-mt-24 outline-none" role="status" data-testid={testId}>
      {children}
    </div>
  );
}
