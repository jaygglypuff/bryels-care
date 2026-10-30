import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { type BatchFlowFacts, orderBatchFacts } from "@/modules/production";
import { Chip } from "@/ui/status";

/**
 * Shared server parts of the G2 operator screens (Materials list, Weigh, Step). Header: back arrow to
 * the order, title, batch number chip (UX review §3 common rules). Operator density on.
 */

/** The batch the screen is for: the one in `?batch=`, else the first live batch that `prefer` accepts, else the first. */
export async function pickBatch(ctx: AuthContext, workOrderId: string, batchParam: string | undefined, prefer: (f: BatchFlowFacts) => boolean) {
  const all = await orderBatchFacts(ctx, db, workOrderId);
  const chosen = batchParam ? all.find((f) => f.batchId === batchParam) : (all.find(prefer) ?? all[0]);
  return { batch: chosen ?? null, all };
}

export function FlowHeader({ title, batchNumber, orderHref, progress, actions }: { title: string; batchNumber: string; orderHref: string; progress?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-3">
      <Link href={orderHref} aria-label="Back to the order" className="inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-full border border-line bg-surface text-fg hover:bg-surface-2">
        <ArrowLeft size={22} aria-hidden />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[24px] font-semibold leading-tight text-fg sm:text-[28px]">{title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-muted">
          <Chip tone="neu">Batch {batchNumber}</Chip>
          {progress}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** The "Nothing here" state when the order has no batch for this screen. */
export function NoBatch({ orderHref, children }: { orderHref: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-[20px] border border-dashed border-line-strong bg-surface-2/60 px-6 py-10 text-center" data-density="operator">
      <p className="text-[17px] font-medium text-fg">{children}</p>
      <Link href={orderHref} className="mt-4 inline-flex min-h-[52px] items-center rounded-full border border-line bg-surface px-6 text-[16px] font-medium text-fg">
        Back to the order
      </Link>
    </div>
  );
}
