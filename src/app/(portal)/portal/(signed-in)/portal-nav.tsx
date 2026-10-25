"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Home, Package, ShoppingBag } from "lucide-react";
import { cx } from "@/ui/core";

const ITEMS = [
  { href: "/portal", label: "Home", icon: Home, exact: true },
  { href: "/portal/order", label: "Order", icon: ShoppingBag, needs: "catalog" as const },
  { href: "/portal/orders", label: "My orders", icon: Package },
  { href: "/portal/documents", label: "Documents", icon: FileText },
];

/** Portal navigation: four pills that fit a 390 px phone without horizontal scrolling. */
export function PortalNav({ canCatalog }: { canCatalog: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => i.needs !== "catalog" || canCatalog);
  return (
    <nav aria-label="Customer portal" className={cx("grid gap-1.5 sm:flex sm:gap-2", items.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
      {items.map((i) => {
        const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
        const Icon = i.icon;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] px-2 text-[11.5px] font-medium transition-colors sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:text-[14px]",
              active ? "bg-[var(--brand-600)] text-white" : "bg-surface text-fg-2 hover:bg-[var(--lime-100)]",
            )}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="truncate">{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
