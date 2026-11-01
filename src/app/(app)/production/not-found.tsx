import { EmptyState, LinkButton } from "@/ui/core";

/**
 * A stale batch or order link on a production screen (re-audit 2026-11-01 N7): a deleted batch, a demo reset or an
 * old stored message. Shown inside the app frame instead of the bare "404 This page could not be found", with the
 * way back. Covers every route under /production that calls notFound().
 */
export default function ProductionNotFound() {
  return (
    <EmptyState title="This batch or order is not here" action={<LinkButton href="/production/orders" variant="secondary">Go to Production orders</LinkButton>}>
      This batch was removed or the demo was reset. Go to Production orders to find the work for today.
    </EmptyState>
  );
}
