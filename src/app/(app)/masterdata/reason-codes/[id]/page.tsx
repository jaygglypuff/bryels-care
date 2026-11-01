import { REASON_CATEGORIES } from "@/db/schema/org";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { REASON_CATEGORY_LABELS, getReasonCode } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { NextStep, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { ActionForm } from "../../_org/form";
import { saveReasonCodeAction } from "../../_org/actions";
import { ActiveChip, ReadOnlyNote } from "../../_org/ui";
import { ReasonFields } from "../reason-fields";

export const metadata = { title: "Reason" };

export default async function ReasonCodePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.reason_code.view")) return <Forbidden what="reasons" permission="masterdata.reason_code.view" />;
  const { id } = await params;
  const { created } = await searchParams;
  let r;
  try {
    r = await getReasonCode(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Reason not found" action={<LinkButton href="/masterdata/reason-codes" variant="secondary">All reasons</LinkButton>}>Go back to the list and pick it by name.</EmptyState>;
    throw e;
  }
  const options = REASON_CATEGORIES.map((c) => ({ value: c, label: REASON_CATEGORY_LABELS[c] }));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={r.name} subtitle={<ActiveChip active={r.isActive} />} actions={<LinkButton href="/masterdata/reason-codes" variant="secondary">All reasons</LinkButton>} />
      <PageIntro>Change the words people see or where the reason is offered. Old records keep it.</PageIntro>
      <NextStep text={r.isActive ? `Offered when: ${r.appliesTo.map((c) => REASON_CATEGORY_LABELS[c as keyof typeof REASON_CATEGORY_LABELS] ?? c).join(", ")}. Nothing to do unless people do not understand the words.` : "Not offered on new records. Old records keep it."} />
      {created === "1" && <Banner tone="ok" title="Reason added">It is offered from now on where you ticked it.</Banner>}
      <Card>
        <CardTitle>Details</CardTitle>
        {ctx.can("masterdata.reason_code.admin") ? (
          <ActionForm action={saveReasonCodeAction} submitLabel="Save" hidden={{ _id: r.id }}>
            <ReasonFields categories={options} d={r} editing />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this reason" />
        )}
      </Card>
    </div>
  );
}
