import { EmptyState, LinkButton } from "@/ui/core";

export function Forbidden({ what = "this page" }: { what?: string }) {
  return (
    <EmptyState title="You don't have access" action={<LinkButton href="/dashboard" variant="secondary">Back to overview</LinkButton>}>
      Your role does not include access to {what}. Ask your site manager if you need it.
    </EmptyState>
  );
}
