import type { AuthContext } from "@/lib/auth/context";
import { paperPackSummary } from "@/modules/production";
import { Card, CardTitle, LinkButton } from "@/ui/core";
import { PaperPackPrint } from "@/ui/paper-pack";
import { CommandForm } from "../work-orders/command-form";
import { makePaperPackAction } from "./paper-actions";
import { NotUsedForm } from "./paper-forms";

/**
 * ADR-134: the "Paper batch record" card on the batch page. Make it (online), print it (works with no internet: the
 * device keeps a copy), type it in later, or say it was not used. Shown to people who may see the batch's documents.
 */
export async function PaperRecordCard({ ctx, batchId }: { ctx: AuthContext; batchId: string }) {
  if (!ctx.can("documents.generated_document.view")) return null;
  const s = await paperPackSummary(ctx, batchId);
  if (!s.packId && !s.canMake) return null;
  const canMake = ctx.can("production.batch.edit") && ctx.can("documents.generated_document.create");
  const canEnter = ctx.can("production.dispense_record.create") || ctx.can("production.process_step_record.create") || ctx.can("production.line_clearance.create");
  const typed = s.pages.filter((p) => p.entries > 0).length;
  return (
    <Card>
      <section aria-labelledby="paper-record-h" className="flex flex-col gap-3" data-testid="paper-record-card">
        <CardTitle>
          <span id="paper-record-h">Paper batch record</span>
        </CardTitle>
        <p className="text-[14px] text-fg-2">For when there is no internet: print it, write on it with a pen, and type it in later. Every page has its own DOC number and QR code.</p>
        {!s.packId ? (
          canMake ? (
            <CommandForm action={makePaperPackAction} fields={{ batchId }} label="Get the paper record ready" pendingText="Making the pages…" variant="secondary" size="lg" />
          ) : (
            <p className="text-[14px] text-muted">No paper record yet. A supervisor can make it.</p>
          )
        ) : (
          <>
            <p className="text-[13px] text-muted">
              {s.pages.length} pages ({s.pages.map((p) => p.reference).join(", ")}){typed ? ` · typed in from ${typed} ${typed === 1 ? "page" : "pages"}` : ""}
            </p>
            <PaperPackPrint userId={ctx.userId} batchId={batchId} version={s.version} />
            {canEnter && (
              <LinkButton href={`/production/${batchId}/from-paper`} variant="secondary" size="lg" data-testid="enter-from-paper">
                Enter from the paper record
              </LinkButton>
            )}
            {canMake && s.unused > 0 && (
              <details className="rounded-[12px] border border-line px-3 py-1">
                <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium">The paper record was not used</summary>
                <NotUsedForm batchId={batchId} />
              </details>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
