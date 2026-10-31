import { requireContext } from "@/lib/auth/context";
import { LABEL_DATASETS, supportedKinds } from "@/modules/documents";
import { Card, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { NewTemplateForm } from "../forms";

export const metadata = { title: "New page layout" };

export default async function NewTemplatePage() {
  const ctx = await requireContext();
  if (!ctx.can("documents.template.create")) return <Forbidden what="creating templates" />;
  const kinds = supportedKinds().map((k) => ({ value: k, label: k === "test_page" ? "Printer test page (A4)" : k === "label" ? "Label layout" : k.replace(/_/g, " "), datasets: k === "label" ? [...LABEL_DATASETS] : [] }));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New page layout" actions={<LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>} />
      <PageIntro>This screen is for the IT person or QA: start a new printed page layout. It starts as a draft with the usual settings; QA must OK it before it prints.</PageIntro>
      <Card>
        <NewTemplateForm kinds={kinds} />
        <p className="mt-4 text-[13px] text-muted">Batch record, delivery paper, pick list and other kinds appear here when the app can print them.</p>
      </Card>
    </div>
  );
}
