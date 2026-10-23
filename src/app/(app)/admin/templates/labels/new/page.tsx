import { requireContext } from "@/lib/auth/context";
import { DEFAULT_LABEL_FIELDS, LABEL_DATASET_FOR, LABEL_FIELD_KEYS, labelLayoutTemplates } from "@/modules/documents";
import { Card, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { LabelTemplateForm } from "../../forms";

export const metadata = { title: "New label template" };

export default async function NewLabelTemplatePage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.label_template.create")) return <Forbidden what="creating label templates" />;
  const layouts = await labelLayoutTemplates(ctx);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New label template" subtitle="Starts as draft; QA approves it before labels print." actions={<LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>} />
      {layouts.length === 0 ? (
        <Banner tone="info" title="No label layout yet">Create a layout of kind label first.</Banner>
      ) : (
        <Card>
          <LabelTemplateForm layouts={layouts} appliesTo={Object.keys(LABEL_DATASET_FOR)} fieldKeys={LABEL_FIELD_KEYS} defaults={DEFAULT_LABEL_FIELDS} />
        </Card>
      )}
    </div>
  );
}
