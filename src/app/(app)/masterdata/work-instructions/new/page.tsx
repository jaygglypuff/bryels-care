import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { Card, Field, Input, PageHeader, Textarea } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { createWorkInstructionAction } from "../../_eng/actions";
import { CreateForm } from "../../_eng/forms";

export const metadata: Metadata = { title: "New work instruction" };

export default async function NewWorkInstructionPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.work_instruction.create")) return <Forbidden what="creating work instructions" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New work instruction" subtitle="Creates draft revision 1. Submit it for approval when the text is final." />
      <Card>
        <CreateForm action={createWorkInstructionAction} submitLabel="Create draft" cancelHref="/masterdata/work-instructions">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="code">
              <Input id="code" name="code" required className="font-mono uppercase" placeholder="WI-LOTION-EMUL" />
            </Field>
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required />
            </Field>
          </div>
          <Field label="Instruction text" htmlFor="bodyMarkdown" hint="Numbered steps, safety notes. Verify with authorized personnel before production use.">
            <Textarea id="bodyMarkdown" name="bodyMarkdown" required className="min-h-[200px]" />
          </Field>
        </CreateForm>
      </Card>
    </div>
  );
}
