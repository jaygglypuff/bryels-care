import Link from "next/link";
import { REASON_CATEGORIES, type ReasonCategory } from "@/db/schema/org";
import { requireContext } from "@/lib/auth/context";
import { REASON_CATEGORY_LABELS, listReasonCodes } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Select } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ReasonFields } from "./reason-fields";
import { ActionForm } from "../_org/form";
import { saveReasonCodeAction } from "../_org/actions";
import { ActiveChip, AddCard } from "../_org/ui";

export const metadata = { title: "Reason codes" };

export default async function ReasonCodesPage({ searchParams }: { searchParams: Promise<{ category?: string; all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.reason_code.view")) return <Forbidden what="reason codes" />;
  const sp = await searchParams;
  const rows = await listReasonCodes(ctx, { category: sp.category, includeInactive: sp.all === "1" });
  const canAdmin = ctx.can("masterdata.reason_code.admin");
  const options = REASON_CATEGORIES.map((c) => ({ value: c, label: REASON_CATEGORY_LABELS[c] }));
  return (
    <div className="space-y-5">
      <PageHeader title="Reason codes" subtitle="The controlled reasons offered on adjustments, counts, holds, receipts, reprints and reversals. A deactivated code stays on old records but cannot be chosen again; codes never change." />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px]">
            Used for
            <Select name="category" defaultValue={sp.category ?? ""}>
              <option value="">All</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 pb-3 text-[13px]">
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="size-4" /> Inactive too
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="No reason codes" action={sp.category || sp.all ? <LinkButton href="/masterdata/reason-codes" variant="secondary">Clear filters</LinkButton> : undefined}>
          Reason codes are installed with the reference data and maintained by the system administrator.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/masterdata/reason-codes/${r.id}`} className="block h-full rounded-[16px] border border-line bg-surface p-3 hover:bg-surface-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="break-all font-mono text-[13px] font-semibold">{r.code}</span>
                  <ActiveChip active={r.isActive} />
                </div>
                <p className="mt-1 text-[14px]">{r.name}</p>
                <p className="mt-2 flex flex-wrap gap-1">
                  {r.appliesTo.map((c) => (
                    <Chip key={c} tone="info">{REASON_CATEGORY_LABELS[c as ReasonCategory] ?? c}</Chip>
                  ))}
                  {r.requiresNote && <Chip tone="warn">Note required</Chip>}
                  {r.requiresApproval && <Chip tone="appr">Needs approval</Chip>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a reason code">
          <ActionForm action={saveReasonCodeAction} submitLabel="Create reason code" variant="cta">
            <ReasonFields categories={options} />
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
