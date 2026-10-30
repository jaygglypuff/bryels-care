import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { listWaitingForCheck } from "@/modules/quality";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata: Metadata = { title: "Waiting for check" };
export const dynamic = "force-dynamic";

/** QA list "Waiting for check" (ADR-080 §8): finished batches of the current site, oldest first. */
export default async function WaitingForCheckPage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="the quality check" />;
  const rows = await listWaitingForCheck(ctx);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Waiting for check" subtitle={`Finished batches at ${ctx.currentSite.name}`} actions={<Help screen="quality.check" />} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing is waiting for the quality check">Finished batches appear here as soon as production presses Finish batch.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <Link href={`/quality/check/${r.id}`} className="flex flex-col gap-1">
                <span className="text-[17px] font-semibold">{r.productName}</span>
                <span className="font-mono text-[13px]">{r.batchNumber}</span>
                <span className="text-[14px] text-fg-2">
                  {r.actualUnits ? `${Number(r.actualUnits)} made` : "—"}
                  {r.completedAt ? ` · finished ${fmtDateTime(r.completedAt)}` : ""}
                </span>
                <span className="flex flex-wrap gap-2">
                  {r.onHold ? <Chip tone="warn">On hold{r.checkAgainOn ? ` · check again ${fmtDate(r.checkAgainOn)}` : ""}</Chip> : <Chip tone="q">Quality check</Chip>}
                  {r.openProblems > 0 && <Chip tone="bad">{r.openProblems} open problem {r.openProblems === 1 ? "report" : "reports"}</Chip>}
                </span>
                <span className="mt-2 inline-flex min-h-[48px] items-center justify-center rounded-full bg-primary px-5 font-semibold text-white">Check quality</span>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
