import { EmptyState, LinkButton } from "@/ui/core";

/** Unknown documents and other customers' documents look the same (404, no detail). */
export default function PortalDocumentNotFound() {
  return (
    <EmptyState title="Document not found" action={<LinkButton href="/portal/documents" variant="secondary">All documents</LinkButton>}>
      This document does not exist in your company&apos;s portal.
    </EmptyState>
  );
}
