import { requireContext } from "@/lib/auth/context";
import { expenseCategories, financeBusinessDate } from "@/modules/finance";
import { LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "Claim money I spent" };

/** New expense claim (US-6-12): four fields; the receipt photo is added on the next screen. */
export default async function NewExpensePage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.expense_claim.create")) return <Forbidden what="expense claims" />;
  const cats = await expenseCategories(ctx.organizationId);
  const sites = ctx.allowedSites.filter((s) => ctx.canAt("finance.expense_claim.create", s.id));
  return (
    <>
      <PageHeader title="Claim money I spent" actions={<LinkButton href="/finance/expenses" variant="secondary">My claims</LinkButton>} />
      <PageIntro>This screen is for getting back money you spent for the company. Save it, add a photo of the receipt on the next screen, then send it for approval.</PageIntro>
      <ExpenseForm categories={cats} sites={sites.map((s) => ({ id: s.id, label: s.name }))} currentSiteId={ctx.currentSiteId} today={financeBusinessDate()} />
    </>
  );
}
