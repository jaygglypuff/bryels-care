import { requireContext } from "@/lib/auth/context";
import { expenseCategories, financeBusinessDate } from "@/modules/finance";
import { LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "New expense claim" };

export default async function NewExpensePage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.expense_claim.create")) return <Forbidden what="expense claims" />;
  const cats = await expenseCategories(ctx.organizationId);
  const sites = ctx.allowedSites.filter((s) => ctx.canAt("finance.expense_claim.create", s.id));
  return (
    <>
      <PageHeader title="New expense claim" subtitle="Save the claim, attach the receipt, then submit it for approval." actions={<LinkButton href="/finance/expenses" variant="secondary">Back</LinkButton>} />
      <ExpenseForm categories={cats} sites={sites.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))} currentSiteId={ctx.currentSiteId} today={financeBusinessDate()} />
    </>
  );
}
