import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { getFormula } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../forbidden";
import { newFormulaRevisionAction } from "../../_eng/actions";
import { CommandForm } from "../../_eng/forms";
import { VerifyBanner } from "../../_eng/ui";
import { PlainVersionChip, useFromText, NEXT_WRAP } from "../../_eng/plain";

export const metadata: Metadata = { title: "Recipe (advanced)" };

export default async function FormulaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="recipes" />;
  const f = /^[0-9a-f-]{36}$/i.test(id) ? await getFormula(ctx, id) : null;
  if (!f) {
    return (
      <EmptyState title="Recipe not found" action={<LinkButton href="/masterdata/formulas" variant="secondary">All recipes</LinkButton>}>
        It may have been deleted. Go back to the list and look for the product name.
      </EmptyState>
    );
  }
  const canNew = ctx.can("masterdata.formula.create") && !f.openRevisionId;
  const canChange = ctx.can("masterdata.formula.create") && ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.create") && ctx.can("masterdata.routing.edit") && ctx.can("masterdata.routing.view");
  const open = f.revisions.find((r) => r.id === f.openRevisionId) ?? null;
  const showBatch = ctx.can("production.batch.create") && !!f.effectiveRevisionId;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/formulas" className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
          ← All recipes (advanced)
        </Link>
        <PageHeader
          title={`Recipe for ${f.product.name}`}
          subtitle={
            <>
              Recipe (advanced) · <RecordNo>{f.formula.code}</RecordNo>
            </>
          }
          actions={
            canNew || showBatch ? (
              <MoreMenu>
                <div className="flex flex-col gap-3">
                  {showBatch && (
                    <Link href="/production/new" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text underline">
                      Make a batch
                    </Link>
                  )}
                  {canNew && <CommandForm action={newFormulaRevisionAction} hidden={{ formulaId: f.formula.id }} label="Start a new version here (advanced)" pendingText="Starting…" variant="secondary" />}
                </div>
              </MoreMenu>
            ) : undefined
          }
        />
      </div>
      <PageIntro>
        This screen is for the versions of one recipe. Most people use New recipe (step by step). These screens are for advanced changes. <Explain term="version" label="What is a version?" />
      </PageIntro>
      {open ? (
        <NextStep
          text={open.status === "pending_approval" ? `Version ${open.revisionNo} is waiting for an OK.` : `Version ${open.revisionNo} is being written.`}
          action={{ label: `Open version ${open.revisionNo}`, href: `/masterdata/formulas/${f.formula.id}/revisions/${open.id}` }}
        />
      ) : canChange ? (
        <NextStep className={NEXT_WRAP} text="To change this recipe, make a new version. Batches already made keep their version." action={{ label: "Make a new version (step by step)", href: `/masterdata/recipes/${f.formula.id}?new=1` }} />
      ) : (
        <NextStep className={NEXT_WRAP} text="See this recipe the simple way: ingredients and steps on one page." action={{ label: "Open the recipe", href: `/masterdata/recipes/${f.formula.id}` }} />
      )}
      <VerifyBanner />
      <Card>
        <CardTitle>Versions</CardTitle>
        {f.revisions.length === 0 ? (
          <p className="text-[14px] text-fg-2">No version yet. Use New recipe (step by step) to write the first one.</p>
        ) : (
          <PlainList label="Versions">
            {f.revisions.map((r) => (
              <PlainRow
                key={r.id}
                href={`/masterdata/formulas/${f.formula.id}/revisions/${r.id}`}
                title={`Version ${r.revisionNo}`}
                status={<PlainVersionChip status={r.status} label={r.label} />}
                facts={[useFromText(r.effectiveFrom, r.effectiveTo, fmtDate), `${fmtQty(D(r.referenceBatchSizeG).div(1000), "kg", 2)} a batch`, r.changeSummary, r.approvedByName ? `OK by ${r.approvedByName}` : null].filter(Boolean).join(" · ")}
              />
            ))}
          </PlainList>
        )}
      </Card>
    </div>
  );
}
