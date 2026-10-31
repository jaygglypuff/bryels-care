import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listInspectionPlans } from "@/modules/masterdata";
import { Chip } from "@/ui/status";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";

export const metadata: Metadata = { title: "Quality checks" };

const KIND: Record<string, string> = { incoming: "When a delivery arrives", in_process: "While making", finished_product: "Finished product" };

export default async function InspectionPlansPage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection_plan.view")) return <Forbidden what="inspection plans" />;
  const rows = await listInspectionPlans(ctx);
  return (
    <div>
      <PageHeader
        title="Quality checks"
        actions={ctx.can("quality.inspection_plan.create") ? <LinkButton href="/masterdata/inspection-plans/new" variant="cta">Add quality checks</LinkButton> : undefined}
      />
      <PageIntro>
        For each material or product: what QA checks and the limits. The system stores them; QA decides them. <Explain term="quality_check" />
      </PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No quality checks yet" action={ctx.can("quality.inspection_plan.create") ? <LinkButton href="/masterdata/inspection-plans/new">Add quality checks for an item</LinkButton> : undefined}>
          QA adds the checks for each material (when it arrives) or product (while making and when finished).
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <Link key={p.id} href={`/masterdata/inspection-plans/${p.id}`}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold text-fg">{p.name}</p>
                    <p className="text-[13px] text-fg-2">
                      {p.appliesTo} · {KIND[p.planKind] ?? p.planKind} · {p.testCount} check{p.testCount === 1 ? "" : "s"}
                    </p>
                    <p className="font-mono text-[11px] text-muted">{p.code}</p>
                  </div>
                  {p.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={p.open?.status ?? "draft"} />}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.isPlaceholder && <Chip tone="warn">Example only, QA to confirm</Chip>}
                  {p.effective && <Chip tone="neu">Version {p.effective.revisionNo} from {p.effective.effectiveFrom ? fmtDate(p.effective.effectiveFrom) : "—"}</Chip>}
                  {p.open && <Chip tone="appr">Version {p.open.revisionNo} {p.open.status.replace(/_/g, " ")}</Chip>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
