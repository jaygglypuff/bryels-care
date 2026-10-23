import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listWorkInstructions } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";

export const metadata: Metadata = { title: "Work instructions" };

export default async function WorkInstructionsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.work_instruction.view")) return <Forbidden what="work instructions" />;
  const rows = await listWorkInstructions(ctx);
  return (
    <div>
      <PageHeader
        title="Work instructions"
        subtitle="Controlled step text linked from routing steps. Each revision is approved by someone other than its author."
        actions={ctx.can("masterdata.work_instruction.create") ? <LinkButton href="/masterdata/work-instructions/new" variant="cta">New instruction</LinkButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No work instructions yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((w) => (
            <Link key={w.id} href={`/masterdata/work-instructions/${w.id}`}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-semibold">{w.code}</p>
                    <p className="font-medium">{w.name}</p>
                  </div>
                  {w.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={w.open?.status ?? "draft"} />}
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {w.effective ? `Rev ${w.effective.revisionNo} effective ${w.effective.effectiveFrom ? fmtDate(w.effective.effectiveFrom) : ""}` : "No effective revision"}
                  {w.open ? ` · rev ${w.open.revisionNo} ${w.open.status.replace(/_/g, " ")}` : ""}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
