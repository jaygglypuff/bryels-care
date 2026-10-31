import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { type BatchFlowFacts, flowBackHref, getBatchFlowFacts, NO_ORDER_SEGMENT, orderBatchFacts } from "@/modules/production";
import { Chip } from "@/ui/status";

/**
 * Shared server parts of the G2 operator screens (Materials list, Weigh, Step). Header: back arrow to
 * the order, title, batch number chip (UX review §3 common rules). Operator density on.
 */

/**
 * The batch the screen is for: the one in `?batch=`, else the first live batch that `prefer` accepts, else the first.
 * A batch made without a production order comes with the order segment `without-order` and is named by
 * `?batch=` (one path for production work, flow-paths.ts); its "back" goes to its batch record.
 */
export async function pickBatch(ctx: AuthContext, workOrderId: string, batchParam: string | undefined, prefer: (f: BatchFlowFacts) => boolean) {
  if (workOrderId === NO_ORDER_SEGMENT) {
    if (!batchParam || !/^[0-9a-f-]{36}$/i.test(batchParam)) return { batch: null, all: [], backHref: "/production/orders" };
    const f = await getBatchFlowFacts(ctx, db, batchParam); // permission + site scope; not_found otherwise
    return { batch: f, all: [f], backHref: flowBackHref(f) };
  }
  const all = await orderBatchFacts(ctx, db, workOrderId);
  const chosen = batchParam ? all.find((f) => f.batchId === batchParam) : (all.find(prefer) ?? all[0]);
  return { batch: chosen ?? null, all, backHref: `/production/orders/${workOrderId}` };
}

/** Where the flow screens of this URL segment go back to (order hub, or "My work" for a batch without an order). */
export function orderHrefOf(workOrderId: string) {
  return workOrderId === NO_ORDER_SEGMENT ? "/production/orders" : `/production/orders/${workOrderId}`;
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
