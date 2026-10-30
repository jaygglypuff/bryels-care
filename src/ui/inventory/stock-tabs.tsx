import Link from "next/link";
import { cx } from "@/ui/core";

export type StockTab = "all" | "material" | "wip" | "product";

const TABS: { key: StockTab; label: string; href: string }[] = [
  { key: "material", label: "Raw materials", href: "/inventory?kind=material" },
  { key: "wip", label: "Work in progress", href: "/inventory/wip" },
  { key: "product", label: "Finished goods", href: "/inventory?kind=product" },
  { key: "all", label: "All stock", href: "/inventory" },
];

/** Raw materials, work in progress and finished goods kept apart (ADR-081, brief Part II §3). */
export function StockTabs({ active }: { active: StockTab }) {
  return (
    <nav aria-label="Stock type">
      {/* Phone: a 2 × 2 grid of buttons, so no tab is cut off. Wider screens: one row of underlined tabs. */}
      <ul className="grid grid-cols-2 gap-1.5 sm:flex sm:gap-1 sm:border-b sm:border-line">
        {TABS.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cx(
                "flex min-h-[44px] items-center justify-center rounded-[10px] border px-3 text-center text-[14px] font-medium sm:-mb-px sm:justify-start sm:whitespace-nowrap sm:rounded-none sm:border-0 sm:border-b-2 sm:px-3.5",
                t.key === active ? "border-[var(--brand-600)] bg-primary-soft text-primary-text sm:bg-transparent" : "border-line bg-surface text-fg-2 hover:text-fg sm:border-transparent sm:bg-transparent",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
