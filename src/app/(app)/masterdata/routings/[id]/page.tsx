import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { getRouting } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { newRoutingRevisionAction } from "../../_eng/actions";
import { CommandForm } from "../../_eng/forms";
import { EffectiveRange, VerifyBanner, VersionChip } from "../../_eng/ui";

export const metadata: Metadata = { title: "Routing" };

export default async function RoutingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="routings" />;
  const r = /^[0-9a-f-]{36}$/i.test(id) ? await getRouting(ctx, id) : null;
  if (!r) return <EmptyState title="Routing not found" action={<LinkButton href="/masterdata/routings" variant="secondary">Back to routings</LinkButton>} />;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/routings" className="text-[13px] text-primary-text hover:underline">
          ← Routings
        </Link>
        <PageHeader title={`${r.routing.code} · ${r.routing.name}`} subtitle={`${r.product.name} (${r.product.skuCode})`} />
      </div>
      <VerifyBanner />
      <Card>
        <CardTitle action={r.canCreateRevision ? <CommandForm action={newRoutingRevisionAction} hidden={{ routingId: r.routing.id }} label="Start new revision" variant="secondary" /> : undefined}>Revisions</CardTitle>
        {r.revisions.length === 0 ? (
          <EmptyState title="No revision yet" />
        ) : (
          <Table head={["Revision", "Status", "Effective", "Change scope", "Change", "Submitted by", "Final approver"]}>
            {r.revisions.map((x) => (
              <tr key={x.id} className="hover:bg-surface-2/60">
                <Td>
                  <Link href={`/masterdata/routings/${r.routing.id}/revisions/${x.id}`} className="font-semibold text-primary-text hover:underline">
                    Rev {x.revisionNo}
                  </Link>
                </Td>
                <Td>
                  <VersionChip status={x.status} label={x.label} />
                </Td>
                <Td className="whitespace-nowrap">
                  <EffectiveRange from={x.effectiveFrom} to={x.effectiveTo} />
                </Td>
                <Td>{x.changeScope ? x.changeScope.replace(/_/g, " ") : "—"}</Td>
                <Td className="max-w-[260px]">{x.changeSummary ?? "—"}</Td>
                <Td>{x.submittedByName ?? "—"}</Td>
                <Td>{x.approvedByName ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
