import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelTestPage } from "@/modules/documents";
import { LinkButton } from "@/ui/core";
import { PrintButton } from "../../../lot-label/print-button";

export const metadata = { title: "Label test page" };

/** T-01 / T-02: label-size test page with sample data and a scaling ruler. Not a recorded document. */
export default async function LabelTestPage({ params }: { params: Promise<{ labelTemplateId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.label_template.view")) return <div className="p-6"><Forbidden what="label templates" /></div>;
  const { labelTemplateId } = await params;
  let r: Awaited<ReturnType<typeof labelTestPage>>;
  try {
    r = await labelTestPage(ctx, labelTemplateId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <main>
      <div className="no-print mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-4 pt-6">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold">Test page · {r.template.code}</h1>
          <p className="text-[13px] text-muted">
            Sample data only. Print at 100 % on the station printer, then measure the ruler (± 0.5 mm) and scan the code with a phone and a handheld scanner (T-01 to T-03).
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/admin/templates/labels/${r.template.id}`} variant="secondary" size="lg">Back</LinkButton>
          <PrintButton label="Print test page" />
        </div>
      </div>
      <style>{r.css}</style>
      <div dangerouslySetInnerHTML={{ __html: r.body }} />
    </main>
  );
}
