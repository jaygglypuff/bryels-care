import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { Card, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { createWorkInstructionAction } from "../../_eng/actions";
import { ActionForm, TextField, TextareaField } from "../../_org/form";

export const metadata: Metadata = { title: "New how-to sheet" };

/** New how-to sheet: a name and the text; the system gives the number (WI-nnnn, ADR-093). */
export default async function NewWorkInstructionPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.work_instruction.create")) return <Forbidden what="writing how-to sheets" />;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New how-to sheet" />
      <PageIntro>This screen is for writing a how-to sheet: a name and the text. It starts as a draft; send it for an OK when the text is final.</PageIntro>
      <Card>
        <ActionForm action={createWorkInstructionAction} submitLabel="Save as draft" pendingText="Saving…" variant="cta" cancelHref="/masterdata/work-instructions">
          <TextField name="name" label="What is it called?" placeholder="e.g. Mixing lye safely" />
          <TextareaField name="bodyMarkdown" label="What should the worker do?" placeholder={"1. Put on gloves and goggles.\n2. …"} hint="Numbered steps and safety notes. QA checks the text before it is used." />
          <MoreDetails>
            <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. WI-0001" mono />
          </MoreDetails>
        </ActionForm>
      </Card>
    </div>
  );
}
