import { EmptyState, LinkButton } from "@/ui/core";

export default function CustomerNotFound() {
  return (
    <EmptyState title="Customer not found" action={<LinkButton href="/sales/customers" variant="secondary">Back to customers</LinkButton>}>
      The customer does not exist in your organization.
    </EmptyState>
  );
}
