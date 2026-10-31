import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { Card, PageHeader, cx } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { GuideView } from "@/ui/help/guide-view";
import { ROLE_GUIDES, listTaskGuides, loadGuide } from "@/ui/help/guides";
import { OpenHash } from "./open-hash";

export const metadata = { title: "Help" };

/**
 * Help (ADR-088 grade-5): five role guides "Your day in 5 steps" (the reader's own role first), the
 * "Words we use" glossary, then the task guides folded (the "?" on each screen opens the same guide;
 * /help#<key> opens it here). Reading needs no permission.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const mine = ROLE_GUIDES.find((r) => r.roles.some((c) => ctx.roleCodes.includes(c))) ?? ROLE_GUIDES[1];
  const chosen = ROLE_GUIDES.find((r) => r.key === sp.role) ?? mine;
  const guide = loadGuide(chosen.key);
  const words = loadGuide("start.words");
  const tasks = listTaskGuides();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <OpenHash />
      <PageHeader title="Help" />
      <PageIntro>This screen is for anyone who is stuck: pick your job and follow the 5 steps. The words in bold are the exact buttons on your screen. Below are the words we use, and help for single tasks.</PageIntro>

      <nav aria-label="Pick your job" className="flex flex-wrap gap-2">
        {ROLE_GUIDES.map((r) => (
          <Link
            key={r.key}
            href={`/help?role=${r.key}`}
            aria-current={r.key === chosen.key ? "page" : undefined}
            className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px]", r.key === chosen.key ? "border-ring bg-primary-soft font-semibold" : "border-line hover:bg-surface-2")}
          >
            {r.label}
            {r.key === mine.key ? " (you)" : ""}
          </Link>
        ))}
      </nav>

      {guide && (
        <Card id={chosen.key} data-testid="role-guide">
          <h2 className="mb-2 font-display text-[20px] font-semibold text-fg">{guide.title}</h2>
          <GuideView guide={guide} />
        </Card>
      )}

      {words && (
        <Card id="start.words">
          <h2 className="mb-2 font-display text-[20px] font-semibold text-fg">{words.title}</h2>
          <GuideView guide={words} />
        </Card>
      )}

      <section aria-labelledby="tasks-h" className="space-y-2">
        <h2 id="tasks-h" className="font-display text-[18px] font-semibold text-fg">Help for one task</h2>
        {tasks.map((g) => (
          <details key={g.key} id={g.key} className="rounded-[14px] border border-line bg-surface px-3.5">
            <summary className="flex min-h-[48px] cursor-pointer items-center text-[15px] font-medium text-fg">{g.title}</summary>
            <div className="pb-4">
              <GuideView guide={g} />
              <p className="mt-3 text-[12px] text-muted">
                Version {g.version}
                {g.updatedAt ? ` · updated ${g.updatedAt}` : ""}
              </p>
            </div>
          </details>
        ))}
      </section>
      <MoreDetails title="Still stuck?">
        <p className="text-[14px] text-fg-2">Ask your site manager. For sign-in problems or a broken screen, ask the IT person. For a quality question, ask QA.</p>
      </MoreDetails>
    </div>
  );
}
