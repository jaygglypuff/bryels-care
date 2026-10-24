import { REASON_CATEGORIES } from "@/db/schema/org";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { REASON_CATEGORY_LABELS, getReasonCode } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ActionForm } from "../../_org/form";
import { saveReasonCodeAction } from "../../_org/actions";
import { ActiveChip, ReadOnlyNote } from "../../_org/ui";
import { ReasonFields } from "../reason-fields";

export const metadata = { title: "Reason code" };

export default async function ReasonCodePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.reason_code.view")) return <Forbidden what="reason codes" />;
  const { id } = await params;
  const { created } = await searchParams;
  let r;
  try {
    r = await getReasonCode(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Reason code not found" action={<LinkButton href="/masterdata/reason-codes" variant="secondary">All reason codes</LinkButton>} />;
    throw e;
  }
  const options = REASON_CATEGORIES.map((c) => ({ value: c, label: REASON_CATEGORY_LABELS[c] }));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={r.name} subtitle={<><span className="font-mono">{r.code}</span> · <ActiveChip active={r.isActive} /></>} actions={<LinkButton href="/masterdata/reason-codes" variant="secondary">All reason codes</LinkButton>} />
      {created === "1" && <Banner tone="ok" title="Reason code created">It is offered on new records of the selected kinds.</Banner>}
      <Card>
        <CardTitle>Reason code</CardTitle>
        {ctx.can("masterdata.reason_code.admin") ? (
          <ActionForm action={saveReasonCodeAction} submitLabel="Save reason code" hidden={{ _id: r.id }}>
            <ReasonFields categories={options} d={r} editing />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this reason code" />
        )}
      </Card>
    </div>
  );
}
