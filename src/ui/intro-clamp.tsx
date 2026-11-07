"use client";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * The sentence "This screen is for…" in one line (two from 640 px), with "more" when it is longer (owner 2026-11-08:
 * the task must be visible on the first phone screen). The clamp is in the server HTML, so the page does not jump
 * when it wakes up; "more" appears once the line is measured. The "more" button is a 44 px target that does not add
 * height to the line (negative margin).
 */
export function IntroClamp({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  return (
    <div className="flex items-start gap-1">
      <div ref={ref} className={open ? "min-w-0 flex-1" : "min-w-0 flex-1 line-clamp-1 sm:line-clamp-2"} data-testid="page-intro-text">
        {children}
      </div>
      {(over || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="-my-[11px] inline-flex min-h-[44px] shrink-0 items-center rounded-full px-2 font-medium text-primary-text hover:bg-primary-soft"
        >
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}
