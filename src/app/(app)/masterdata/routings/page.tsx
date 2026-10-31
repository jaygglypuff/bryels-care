import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listRoutings } from "@/modules/masterdata";
import { EmptyState, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { CommandForm } from "../_eng/forms";
import { soapExampleAction } from "../_eng/actions";
import { Forbidden } from "../../forbidden";
import { PlainVersionChip, NEXT_WRAP } from "../_eng/plain";

export const metadata: Metadata = { title: "Steps (advanced)" };

export default async function RoutingsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="steps for each product" />;
  const rows = await listRoutings(ctx);
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const canCreate = ctx.can("masterdata.routing.create");
  const canSheets = ctx.can("masterdata.work_instruction.view");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Steps (advanced)"
        actions={
          canCreate || canSheets ? (
            <MoreMenu>
              <div className="flex flex-col gap-3">
                {canSheets && (
                  <Link href="/masterdata/work-instructions" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text underline">
                    How-to sheets
                  </Link>
                )}
                {canCreate && (
                  <Link href="/masterdata/routings/new" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text underline">
                    New steps (advanced)
                  </Link>
                )}
                {canCreate && <CommandForm action={soapExampleAction} hidden={{}} label="Add the soap steps example" variant="secondary" pendingText="Adding…" />}
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>
        This screen is for advanced changes to the steps a worker follows to make a product (checks, weighing, making, waiting, wrapping). Most people use New recipe (step by step). These screens are for advanced changes.{" "}
        <Explain term="version" label="What is a version?" />
      </PageIntro>
      {canWizard ? (
        <NextStep className={NEXT_WRAP} text="Making or changing steps? The step-by-step recipe does the ingredients and the steps together." action={{ label: "New recipe (step by step)", href: "/masterdata/recipes/new" }} />
      ) : (
        <NextStep className={NEXT_WRAP} text="To see a recipe and its steps the simple way, open the recipe list." action={{ label: "Open the recipes", href: "/masterdata/recipes" }} />
      )}
      {rows.length === 0 ? (
        <EmptyState title="No steps yet">A product needs approved steps before a batch can be planned. {canWizard ? "Use New recipe (step by step)." : "Ask the planner."}</EmptyState>
      ) : (
        <PlainList label="Steps for each product">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              href={`/masterdata/routings/${r.id}`}
              title={r.productName}
              code={r.code}
              status={r.effective ? <PlainVersionChip status="approved" label="effective" /> : <PlainVersionChip status={r.open?.status ?? "draft"} />}
              facts={[
                r.effective ? `Version ${r.effective.revisionNo} in use · ${r.effective.stepCount} steps` : "No approved version yet",
                r.open ? `version ${r.open.revisionNo} ${r.open.status === "pending_approval" ? "waiting for an OK" : "being written"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </PlainList>
      )}
    </div>
  );
}
