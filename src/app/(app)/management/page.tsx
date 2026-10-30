import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { buildNav, groupSections } from "../nav";

export const metadata = { title: "Management" };

/** What each Management section is for, in plain words (ADR-081). */
const ABOUT: Record<string, string> = {
  "Reports & analytics": "Dashboards, trends and the report library. Actual figures, with forecasts labelled as such.",
  Purchasing: "Purchase requests and orders, suppliers and reorder suggestions.",
  Finance: "Supplier bills, expenses, period locks and tax setup. Customer invoices and payments are under Sales & Customers.",
  "Production setup": "Products, formulas, steps, work instructions, inspection plans and equipment.",
  "Master data": "Materials, products, suppliers, locations, sites and lists used everywhere else.",
  "People & access": "Users, roles, sign-in sessions and security.",
  System: "Audit log, settings, approval rules, numbering, templates, imports and devices.",
};

/**
 * Management landing page (ADR-081, brief Part II §3): everything that is not daily floor work, grouped
 * by section. It shows only what the signed-in user may open; the pages themselves still check access.
 */
export default async function ManagementPage() {
  const ctx = await requireContext();
  const group = buildNav((p) => ctx.can(p), ctx.roleCodes).find((g) => g.label === "Management");
  const sections = group ? groupSections(group).sections : [];
  return (
    <div className="space-y-5">
      <PageHeader title="Management" subtitle="People, money, purchasing, reports, setup and settings" />
      {sections.length === 0 ? (
        <EmptyState title="Nothing to manage with your role">Management pages are for owners, managers and administrators. Ask your site manager if you need access.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((sec) => (
            <Card key={sec.name} aria-labelledby={`sec-${sec.name}`}>
              <h2 id={`sec-${sec.name}`} className="font-display text-[17px] font-semibold text-fg">{sec.name}</h2>
              {ABOUT[sec.name] && <p className="mt-1 text-[13px] text-muted">{ABOUT[sec.name]}</p>}
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {sec.items.map((i) =>
                  i.planned ? (
                    <li key={i.label} className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12.5px] text-muted" aria-disabled="true">
                      {i.label} · {i.planned}
                    </li>
                  ) : (
                    <li key={i.href}>
                      <Link href={i.href} className="block rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
                        {i.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
