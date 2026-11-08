import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { IT_SYSTEM, PEOPLE_SETTINGS, setupSections } from "../nav";

export const metadata = { title: "Set-up" };

/** What each Set-up section is for, in plain words. */
const ABOUT: Record<string, string> = {
  "Products and recipes": "What you make and sell, what it is made of, prices, and how to make it.",
  "Places and machines": "Shelves and areas, machines, sites, warehouses and making areas.",
  [PEOPLE_SETTINGS]: "Who can sign in, what each job may do, settings, who says OK to what, labels and record numbers.",
  Lists: "Short lists the other screens use: units, choices and reasons.",
  [IT_SYSTEM]: "For the IT person: system health, spreadsheets, sign-in safety, phones and tablets, old records.",
};

/**
 * Set-up (round 5, ADR-129): the screens you use once in a while to set the company up, opened from the avatar menu
 * ("Set-up") and from search. They left the daily menu (B report #10). Only screens the person may open are listed;
 * every page still checks access on the server. Rarely used entries are folded.
 */
export default async function SetupPage() {
  const ctx = await requireContext();
  const sections = setupSections((p) => ctx.can(p), ctx.roleCodes);
  return (
    <div className="space-y-5">
      <PageHeader title="Set-up" />
      <PageIntro>This screen is for setting the company up: products, recipes, materials, people, settings, labels, shelves and machines. You use it once in a while, not every day.</PageIntro>
      {sections.length === 0 ? (
        <EmptyState title="Nothing to set up for your job">Set-up is for the owner, managers and the IT person. Ask your site manager if you need something changed.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((sec) => {
            const daily = sec.items.filter((i) => !i.advanced);
            const rare = sec.items.filter((i) => i.advanced);
            const row = (i: (typeof sec.items)[number]) => (
              <li key={i.href}>
                <Link href={i.href} className="flex min-h-[48px] items-center justify-between gap-2 rounded-[12px] px-3 text-[15px] font-medium text-fg hover:bg-surface-2">
                  {i.label}
                  <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            );
            return (
              <Card key={sec.name}>
                <h2 className="font-display text-section font-semibold text-fg">{sec.name}</h2>
                {ABOUT[sec.name] && <p className="mt-1 text-[13px] text-muted">{ABOUT[sec.name]}</p>}
                {daily.length > 0 && <ul className="mt-2 divide-y divide-line">{daily.map(row)}</ul>}
                {rare.length > 0 && (
                  <details className="mt-1">
                    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-[12px] px-3 text-[14px] font-medium text-muted hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                      {daily.length > 0 ? "Less used" : "Open the list"} <ChevronDown size={14} aria-hidden />
                    </summary>
                    <ul className="divide-y divide-line">{rare.map(row)}</ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
