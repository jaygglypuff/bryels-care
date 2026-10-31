import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { buildNav, groupSections } from "../nav";

export const metadata = { title: "Management" };

/** What each Management section is for, in plain words (ADR-081). */
const ABOUT: Record<string, string> = {
  "Reports & analytics": "How the business is doing: sales, batches, stock and quality numbers, and lists to download.",
  Purchasing: "Buying from suppliers: requests, orders, what to buy again.",
  Finance: "Supplier bills, closing a month, tax set-up. Customer invoices are under Sales & Customers; expense claims under Home.",
  "Production setup": "Recipes, steps, work instructions, QA test plans and machines.",
  "Master data": "The lists everything else uses: materials, products, places, sites. Suppliers are under Purchasing.",
  "People & access": "Who can sign in and what each job may do.",
  "Rules and settings": "Settings, who says OK to what, who gets which message, labels, record numbers, history of changes.",
  "Planning tools": "The production plan for the weeks ahead and the batch records.",
  "IT and system": "For the IT person: who is signed in, sign-in safety, phones and tablets, system health, keeping old records, loading data from spreadsheets.",
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
      <PageHeader title="Management" />
      <PageIntro>This screen is for the owner, managers and the IT person: everything that is not daily floor work – reports, buying, money, set-up lists, people and settings. You only see what your job may open.</PageIntro>
      {sections.length === 0 ? (
        <EmptyState title="Nothing here for your job">These pages are for the owner, managers and the IT person. Ask your site manager if you need one.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((sec) => (
            <Card key={sec.name} aria-labelledby={`sec-${sec.name}`}>
              <h2 id={`sec-${sec.name}`} className="font-display text-[17px] font-semibold text-fg">{sec.name}</h2>
              {ABOUT[sec.name] && <p className="mt-1 text-[13px] text-muted">{ABOUT[sec.name]}</p>}
              <ul className="mt-3 flex flex-wrap gap-2">
                {sec.items.map((i) =>
                  i.planned ? (
                    <li key={i.label} className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-line px-4 text-[13px] text-muted" aria-disabled="true">
                      {i.label} · {i.planned}
                    </li>
                  ) : (
                    <li key={i.href}>
                      <Link href={i.href} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
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
