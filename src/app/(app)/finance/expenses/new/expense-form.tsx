"use client";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { createExpenseAction } from "../../actions";

/** "Claim money I spent": what for, how much, when (today), kind; the site defaults to the current one. The claim number is made by the server. */
export function ExpenseForm({ categories, sites, currentSiteId, today }: { categories: { code: string; label: string }[]; sites: { id: string; label: string }[]; currentSiteId: string; today: string }) {
  return (
    <Card className="max-w-2xl">
      <ActionForm action={createExpenseAction} submit="Save the claim" variant="cta" pending="Saving…">
        {(fe) => (
          <>
            <Field label="What was it for?" htmlFor="e-desc" error={fe.description}>
              <Textarea id="e-desc" name="description" required minLength={3} maxLength={500} placeholder="For example: taxi to the supplier with samples" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="How much (₱)" htmlFor="e-amount" error={fe.amount}>
                <Input id="e-amount" name="amount" inputMode="decimal" placeholder="0.00" required />
              </Field>
              <Field label="When" htmlFor="e-date" error={fe.expenseDate}>
                <Input id="e-date" name="expenseDate" type="date" max={today} defaultValue={today} required />
              </Field>
              <Field label="Kind" htmlFor="e-cat" error={fe.categoryCode}>
                <Select id="e-cat" name="categoryCode" defaultValue={categories[0]?.code}>
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {sites.length > 1 && (
              <MoreDetails>
                <Field label="For which site" htmlFor="e-site" error={fe.siteId}>
                  <Select id="e-site" name="siteId" defaultValue={currentSiteId}>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </MoreDetails>
            )}
          </>
        )}
      </ActionForm>
    </Card>
  );
}
