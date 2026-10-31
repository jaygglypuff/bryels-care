import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listWorkInstructions } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { PlainVersionChip } from "../_eng/plain";

export const metadata: Metadata = { title: "How-to sheets" };

export default async function WorkInstructionsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.work_instruction.view")) return <Forbidden what="how-to sheets" />;
  const rows = await listWorkInstructions(ctx);
  const canCreate = ctx.can("masterdata.work_instruction.create");
  return (
    <div className="space-y-5">
      <PageHeader title="How-to sheets" actions={canCreate ? <LinkButton href="/masterdata/work-instructions/new" variant="cta">New how-to sheet</LinkButton> : undefined} />
      <PageIntro>
        This screen is for the written how-to sheets a worker can open from a step (for example how to mix lye safely). Someone other than the writer says OK to each version.{" "}
        <Explain term="version" label="What is a version?" />
      </PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No how-to sheets yet" action={canCreate ? <LinkButton href="/masterdata/work-instructions/new">Write the first one</LinkButton> : undefined}>
          {canCreate ? "Write the safety and how-to text once; steps can then show it to the worker." : "QA or the planner writes how-to sheets."}
        </EmptyState>
      ) : (
        <PlainList label="How-to sheets">
          {rows.map((w) => (
            <PlainRow
              key={w.id}
              href={`/masterdata/work-instructions/${w.id}`}
              title={w.name}
              code={w.code}
              status={w.effective ? <PlainVersionChip status="approved" label="effective" /> : <PlainVersionChip status={w.open?.status ?? "draft"} />}
              facts={[
                w.effective ? `Version ${w.effective.revisionNo} in use${w.effective.effectiveFrom ? ` since ${fmtDate(w.effective.effectiveFrom)}` : ""}` : "No approved version yet",
                w.open ? `version ${w.open.revisionNo} ${w.open.status === "pending_approval" ? "waiting for an OK" : "being written"}` : null,
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
