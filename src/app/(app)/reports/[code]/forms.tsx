"use client";
import { Card, CardTitle, Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { updateReportDefinitionAction } from "../actions";

/** analytics.report.admin: switch the report on or off for the organization and set the owner note (audited). */
export function ReportAdminForm({ code, enabled, ownerNote }: { code: string; enabled: boolean; ownerNote: string | null }) {
  return (
    <Card>
      <CardTitle>Report administration</CardTitle>
      <ActionForm action={updateReportDefinitionAction} hidden={{ code }} submit="Save report settings" variant="secondary">
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status" htmlFor="enabled" error={fe.enabled}>
              <Select id="enabled" name="enabled" defaultValue={enabled ? "on" : "off"}>
                <option value="on">Available to users</option>
                <option value="off">Switched off</option>
              </Select>
            </Field>
            <Field label="Owner note (printed as a footnote)" htmlFor="ownerNote" error={fe.ownerNote}>
              <Input id="ownerNote" name="ownerNote" defaultValue={ownerNote ?? ""} maxLength={500} placeholder="e.g. Definition reviewed by the plant manager" />
            </Field>
            <Field label="Reason" htmlFor="reason" error={fe.reason}>
              <Input id="reason" name="reason" required minLength={3} maxLength={500} />
            </Field>
          </div>
        )}
      </ActionForm>
    </Card>
  );
}
