"use client";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { createExpenseAction } from "../../actions";

export function ExpenseForm({ categories, sites, currentSiteId, today }: { categories: { code: string; label: string }[]; sites: { id: string; label: string }[]; currentSiteId: string; today: string }) {
  return (
    <Card className="max-w-2xl">
      <ActionForm action={createExpenseAction} submit="Save claim" variant="cta" pending="Saving…">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="e-cat" error={fe.categoryCode}>
              <Select id="e-cat" name="categoryCode" defaultValue={categories[0]?.code}>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date of the expense" htmlFor="e-date" error={fe.expenseDate}>
              <Input id="e-date" name="expenseDate" type="date" max={today} defaultValue={today} required />
            </Field>
            <Field label="Amount" htmlFor="e-amount" error={fe.amount}>
              <Input id="e-amount" name="amount" inputMode="decimal" placeholder="0.00" required />
            </Field>
            {sites.length > 1 && (
              <Field label="Site" htmlFor="e-site" error={fe.siteId}>
                <Select id="e-site" name="siteId" defaultValue={currentSiteId}>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="sm:col-span-2">
              <Field label="What was it for?" htmlFor="e-desc" error={fe.description}>
                <Textarea id="e-desc" name="description" required minLength={3} maxLength={500} />
              </Field>
            </div>
          </div>
        )}
      </ActionForm>
    </Card>
  );
}
