import { requireContext } from "@/lib/auth/context";
import { LABEL_DATASETS, supportedKinds } from "@/modules/documents";
import { Card, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { NewTemplateForm } from "../forms";

export const metadata = { title: "New layout" };

export default async function NewTemplatePage() {
  const ctx = await requireContext();
  if (!ctx.can("documents.template.create")) return <Forbidden what="creating templates" />;
  const kinds = supportedKinds().map((k) => ({ value: k, label: k === "test_page" ? "Printer test page (A4)" : k === "label" ? "Label layout" : k.replace(/_/g, " "), datasets: k === "label" ? [...LABEL_DATASETS] : [] }));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New layout" subtitle="Starts as draft v1 with the renderer's default configuration." actions={<LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>} />
      <Card>
        <NewTemplateForm kinds={kinds} />
        <p className="mt-4 text-[12px] text-muted">BMR, delivery receipt, pick list and other kinds become available when their renderers ship with their modules.</p>
      </Card>
    </div>
  );
}
