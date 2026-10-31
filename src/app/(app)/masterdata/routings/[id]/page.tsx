import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { getRouting, listFormulas } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../forbidden";
import { newRoutingRevisionAction } from "../../_eng/actions";
import { CommandForm } from "../../_eng/forms";
import { VerifyBanner } from "../../_eng/ui";
import { PlainVersionChip, useFromText, NEXT_WRAP } from "../../_eng/plain";

export const metadata: Metadata = { title: "Steps (advanced)" };

const SCOPE_WORDS: Record<string, string> = { sequencing_only: "only the order of steps", quality_relevant: "what the steps do" };

export default async function RoutingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="steps for each product" />;
  const r = /^[0-9a-f-]{36}$/i.test(id) ? await getRouting(ctx, id) : null;
  if (!r)
    return (
      <EmptyState title="Steps not found" action={<LinkButton href="/masterdata/routings" variant="secondary">All steps</LinkButton>}>
        They may have been deleted. Go back to the list and look for the product name.
      </EmptyState>
    );
  const recipe = ctx.can("masterdata.formula.view") ? ((await listFormulas(ctx)).find((f) => f.productId === r.product.id) ?? null) : null;
  const canChange = ctx.can("masterdata.formula.create") && ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.create") && ctx.can("masterdata.routing.edit");
  const open = r.revisions.find((x) => x.status === "draft" || x.status === "pending_approval") ?? null;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/routings" className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
          ← All steps (advanced)
        </Link>
        <PageHeader
          title={`Steps for ${r.product.name}`}
          subtitle={
            <>
              Steps (advanced) · <RecordNo>{r.routing.code}</RecordNo>
            </>
          }
          actions={
            r.canCreateRevision ? (
              <MoreMenu>
                <CommandForm action={newRoutingRevisionAction} hidden={{ routingId: r.routing.id }} label="Start a new version here (advanced)" variant="secondary" />
              </MoreMenu>
            ) : undefined
          }
        />
      </div>
      <PageIntro>
        This screen is for the versions of one product&apos;s steps. Most people use New recipe (step by step). These screens are for advanced changes. <Explain term="version" label="What is a version?" />
      </PageIntro>
      {open ? (
        <NextStep
          text={open.status === "pending_approval" ? `Version ${open.revisionNo} is waiting for an OK.` : `Version ${open.revisionNo} is being written.`}
          action={{ label: `Open version ${open.revisionNo}`, href: `/masterdata/routings/${r.routing.id}/revisions/${open.id}` }}
        />
      ) : recipe && canChange ? (
        <NextStep className={NEXT_WRAP} text="To change the steps, make a new version of the recipe. Batches already made keep their version." action={{ label: "Make a new version (step by step)", href: `/masterdata/recipes/${recipe.formulaId}?new=1` }} />
      ) : recipe ? (
        <NextStep className={NEXT_WRAP} text="See the recipe and its steps the simple way." action={{ label: "Open the recipe", href: `/masterdata/recipes/${recipe.formulaId}` }} />
      ) : (
        <NextStep className={NEXT_WRAP} text="These steps have no recipe yet." waitingFor="The planner makes the recipe step by step." />
      )}
      <VerifyBanner />
      <Card>
        <CardTitle>Versions</CardTitle>
        {r.revisions.length === 0 ? (
          <p className="text-[14px] text-fg-2">No version yet.</p>
        ) : (
          <PlainList label="Versions">
            {r.revisions.map((x) => (
              <PlainRow
                key={x.id}
                href={`/masterdata/routings/${r.routing.id}/revisions/${x.id}`}
                title={`Version ${x.revisionNo}`}
                status={<PlainVersionChip status={x.status} label={x.label} />}
                facts={[useFromText(x.effectiveFrom, x.effectiveTo, fmtDate), x.changeScope ? `changes ${SCOPE_WORDS[x.changeScope] ?? x.changeScope.replace(/_/g, " ")}` : null, x.changeSummary, x.approvedByName ? `OK by ${x.approvedByName}` : null].filter(Boolean).join(" · ")}
              />
            ))}
          </PlainList>
        )}
      </Card>
    </div>
  );
}
