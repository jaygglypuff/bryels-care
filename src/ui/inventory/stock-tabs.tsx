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
    <nav aria-label="Stock type" className="scroll-x-hidden -mx-1 overflow-x-auto px-1">
      <ul className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cx(
                "-mb-px flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3.5 text-[14px] font-medium",
                t.key === active ? "border-[var(--brand-600)] text-primary-text" : "border-transparent text-fg-2 hover:text-fg",
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
