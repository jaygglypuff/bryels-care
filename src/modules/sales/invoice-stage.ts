import "server-only";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";

/**
 * ADR-126 setting 4 `sales.show_invoice_stage_without_invoice_access`, extended by ADR-133 item 6 (ADR-126 open point).
 *
 * Off: people who may not open invoices at the order's site (`finance.invoice.view`) see no invoice stage anywhere a
 * customer order shows one. Until ADR-133 this covered only the delivery and order "next step" (billing-step.ts).
 *
 * | Where                                   | Off, without invoice access                                     |
 * |-----------------------------------------|-----------------------------------------------------------------|
 * | Order status chip (list, page, board)   | "Billed" (`invoiced`) reads as "Sent out" (`shipped`)            |
 * | Order list counts and the status filter | billed orders are counted and found under "Sent out"            |
 * | Order "What happened"                   | the step to "Billed" is left out                                 |
 * | Customer's order history                | as the status chip                                               |
 * | Home "Recent activity"                  | invoice events (made, saved to the books) are left out           |
 *
 * The stored status is unchanged; this is what a viewer is shown. The services apply it, never only the screens.
 */
export async function invoiceStageHidden(ctx: AuthContext, siteId: string): Promise<boolean> {
  if (ctx.canAt("finance.invoice.view", siteId)) return false;
  return !(await getSetting(db, ctx.organizationId, "sales.show_invoice_stage_without_invoice_access"));
}

/** The order status a viewer is shown (pure). */
export function shownOrderStatus<S extends string>(status: S, hidden: boolean): S | "shipped" {
  return hidden && status === "invoiced" ? "shipped" : status;
}

/** Order state changes a viewer is shown: the step to or from "Billed" collapses into "Sent out" (pure). */
export function shownTransitions<T extends { fromState: string | null; toState: string }>(rows: readonly T[], hidden: boolean): T[] {
  if (!hidden) return [...rows];
  return rows
    .map((r) => ({ ...r, fromState: r.fromState === "invoiced" ? "shipped" : r.fromState, toState: r.toState === "invoiced" ? "shipped" : r.toState }))
    .filter((r) => r.fromState !== r.toState);
}
