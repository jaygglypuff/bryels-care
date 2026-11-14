import { Tabs } from "@/ui/kit";

export type StockTab = "all" | "material" | "wip" | "product";

const TABS: { key: StockTab; label: string; href: string }[] = [
  { key: "material", label: "Raw materials", href: "/inventory?kind=material" },
  { key: "wip", label: "Being made", href: "/inventory/wip" },
  { key: "product", label: "Finished goods", href: "/inventory?kind=product" },
  { key: "all", label: "All stock", href: "/inventory?kind=all" },
];

/**
 * Raw materials, work in progress and finished goods kept apart (ADR-081, brief Part II §3). ADR-136: the page title
 * is "Stock" (the menu word) and these are its underline tabs at every width.
 */
export function StockTabs({ active, bare = false }: { active: StockTab; bare?: boolean }) {
  return <Tabs label="Stock type" active={active} bare={bare} items={TABS} />;
}

/** The name of the open tab (the page's meta line). */
export const stockTabLabel = (k: StockTab) => TABS.find((t) => t.key === k)?.label ?? "Stock";
