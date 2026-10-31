import Link from "next/link";
import { REASON_CATEGORIES, type ReasonCategory } from "@/db/schema/org";
import { requireContext } from "@/lib/auth/context";
import { REASON_CATEGORY_LABELS, listReasonCodes } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Select } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ReasonFields } from "./reason-fields";
import { ActionForm } from "../_org/form";
import { saveReasonCodeAction } from "../_org/actions";
import { ActiveChip, AddCard } from "../_org/ui";

export const metadata = { title: "Reasons" };

export default async function ReasonCodesPage({ searchParams }: { searchParams: Promise<{ category?: string; all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.reason_code.view")) return <Forbidden what="reasons" />;
  const sp = await searchParams;
  const rows = await listReasonCodes(ctx, { category: sp.category, includeInactive: sp.all === "1" });
  const canAdmin = ctx.can("masterdata.reason_code.admin");
  const options = REASON_CATEGORIES.map((c) => ({ value: c, label: REASON_CATEGORY_LABELS[c] }));
  return (
    <div className="space-y-5">
      <PageHeader title="Reasons" />
      <PageIntro>The reasons people pick when they fix stock, put something on hold, throw something away or print again. Add your own in plain words.</PageIntro>
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
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="size-4" /> Switched-off too
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="No reasons" action={sp.category || sp.all ? <LinkButton href="/masterdata/reason-codes" variant="secondary">Clear filters</LinkButton> : undefined}>
          {sp.category || sp.all ? "Try another choice, or clear the filter." : canAdmin ? "Add one below in plain words." : "Ask the system administrator to add reasons."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/masterdata/reason-codes/${r.id}`} className="block h-full rounded-[16px] border border-line bg-surface p-3 hover:bg-surface-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-[16px] font-semibold text-fg">{r.name}</span>
                  <ActiveChip active={r.isActive} />
                </div>
                <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{r.code}</p>
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
        <AddCard title="Add a reason">
          <ActionForm action={saveReasonCodeAction} submitLabel="Add reason" variant="cta">
            <ReasonFields categories={options} />
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
