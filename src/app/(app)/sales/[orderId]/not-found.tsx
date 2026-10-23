import { EmptyState, LinkButton } from "@/ui/core";

export default function OrderNotFound() {
  return (
    <EmptyState title="Order not found" action={<LinkButton href="/sales" variant="secondary">Back to sales orders</LinkButton>}>
      The order does not exist or belongs to a site you are not assigned to.
    </EmptyState>
  );
}
