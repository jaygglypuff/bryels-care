import { BellOff } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { FLOW_ITEM_LIMIT, ageWords, getWorkFlowItems, isFlowCountKey } from "@/modules/analytics";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "What waits at this step" };

/** The records behind one number of "How work flows", oldest first; each row opens its own record. */
export default async function WorkFlowItemsPage({ params }: { params: Promise<{ count: string }> }) {
  const ctx = await requireContext();
  const { count: key } = await params;
  const back = <LinkButton href="/operations/flow" variant="secondary">How work flows</LinkButton>;
  if (!isFlowCountKey(key)) return <EmptyState title="This list does not exist" action={back}>Go back to How work flows and tap a number there.</EmptyState>;
  let r: Awaited<ReturnType<typeof getWorkFlowItems>>;
  try {
    r = await getWorkFlowItems(ctx, key);
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden")
      return (
        <EmptyState title="You don't have access" action={back}>
          Your role does not show this list at this site. Ask your site manager if you need it.
        </EmptyState>
      );
    throw e;
  }
  const { stage, count, items } = r;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`${stage.n}. ${stage.title}`} subtitle={`${count.words} · ${stage.who}`} actions={back} />
      <PageIntro>This screen is for what waits at one step of the work, oldest first. Tap one to open it.</PageIntro>
      <NextStep text={`Who does it: ${stage.who}.`} action={stage.button} />
      {items.length === 0 ? (
        <EmptyState title="Nothing waits here">Nothing is at this step right now.</EmptyState>
      ) : (
        <PlainList label={count.words}>
          {items.map((i) => (
            <PlainRow
              key={i.id}
              href={i.href}
              title={i.label || i.ref}
              code={i.ref}
              tone={!i.told && count.untold > 0 ? "bad" : undefined}
              status={!i.told && count.untold > 0 ? (
                <Chip tone="bad">
                  <BellOff size={12} aria-hidden /> Nobody told
                </Chip>
              ) : undefined}
              facts={`Since ${fmtDate(i.since)}`}
              aside={ageWords(i.since)}
            />
          ))}
        </PlainList>
      )}
      {count.capped && <p className="mt-3 text-[13px] text-muted">Only the oldest {FLOW_ITEM_LIMIT} are shown.</p>}
    </div>
  );
}
