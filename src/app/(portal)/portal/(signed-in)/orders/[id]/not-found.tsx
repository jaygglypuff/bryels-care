import { EmptyState, LinkButton } from "@/ui/core";

/** Unknown ids and other customers' orders look the same (404, no detail). */
export default function PortalOrderNotFound() {
  return (
    <EmptyState title="Order not found" action={<LinkButton href="/portal/orders" variant="secondary">My orders</LinkButton>}>
      This order does not exist in your company&apos;s portal.
    </EmptyState>
  );
}
