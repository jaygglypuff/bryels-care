import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listInspectionPlans } from "@/modules/masterdata";
import { Chip } from "@/ui/status";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";

export const metadata: Metadata = { title: "Inspection plans" };

const KIND: Record<string, string> = { incoming: "Incoming", in_process: "In-process", finished_product: "Finished product" };

export default async function InspectionPlansPage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection_plan.view")) return <Forbidden what="inspection plans" />;
  const rows = await listInspectionPlans(ctx);
  return (
    <div>
      <PageHeader
        title="Inspection plans"
        subtitle="QA-controlled tests, methods and specification limits. The system stores them; it never decides them."
        actions={ctx.can("quality.inspection_plan.create") ? <LinkButton href="/masterdata/inspection-plans/new" variant="cta">New plan</LinkButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No inspection plans yet">QA creates a plan per material (incoming) or product (in-process, finished product).</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <Link key={p.id} href={`/masterdata/inspection-plans/${p.id}`}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-semibold">{p.code}</p>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-[12px] text-muted">
                      {KIND[p.planKind] ?? p.planKind} · {p.appliesTo} · {p.testCount} tests
                    </p>
                  </div>
                  {p.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={p.open?.status ?? "draft"} />}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.isPlaceholder && <Chip tone="warn">Placeholder, QA review pending</Chip>}
                  {p.effective && <Chip tone="neu">Rev {p.effective.revisionNo} from {p.effective.effectiveFrom ? fmtDate(p.effective.effectiveFrom) : "—"}</Chip>}
                  {p.open && <Chip tone="appr">Rev {p.open.revisionNo} {p.open.status.replace(/_/g, " ")}</Chip>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
