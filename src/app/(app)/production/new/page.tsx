import type { Metadata } from "next";
import { uuidv7 } from "uuidv7";
import { requireContext } from "@/lib/auth/context";
import { approvedFormulaOptions, manilaToday } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { NewBatchForm } from "./form";

export const metadata: Metadata = { title: "New batch" };

export default async function NewBatchPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.create")) return <Forbidden what="planning batches" />;
  const options = await approvedFormulaOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New batch" subtitle={`Plan a batch at ${ctx.currentSite.code} · ${ctx.currentSite.name}`} />
      {options.length === 0 ? (
        <EmptyState title="No approved formula available" action={<LinkButton href="/masterdata/formulas" variant="secondary">View formulas</LinkButton>}>
          A batch can only be planned from an approved formula revision. Ask the process owner to approve one.
        </EmptyState>
      ) : (
        <NewBatchForm
          options={options.map((o) => ({ ...o, lineCount: Number(o.lineCount), stepCount: Number(o.stepCount) }))}
          today={manilaToday()}
          idempotencyKey={uuidv7()}
        />
      )}
    </div>
  );
}
