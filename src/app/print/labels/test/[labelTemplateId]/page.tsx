import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelTestPage } from "@/modules/documents";
import { LabelSheet } from "@/ui/labels";
import { PrintNow } from "../../print-bits";

export const metadata = { title: "Label test page" };

/**
 * T-01 / T-02: a test label with sample data and a 50 mm ruler, drawn by the same label component as every
 * real label (ADR-099). Not recorded. Print at 100 %, measure the ruler, scan the code.
 */
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
    <main className="min-h-dvh pb-10">
      <div className="no-print mx-auto grid max-w-2xl gap-3 px-4 pt-4">
        <a href={`/admin/templates/labels/${r.template.id}`} className="inline-flex min-h-[44px] items-center gap-2 text-[16px] font-semibold text-primary-text hover:underline">
          <ArrowLeft size={18} aria-hidden /> Back
        </a>
        <h1 className="text-[22px] font-semibold">Test label: {r.template.name}</h1>
        <p className="text-[15px] text-fg-2">
          Sample data only, not recorded. Print at <strong>Actual size / 100 %</strong>, then measure the ruler (50 mm ± 0.5 mm) and scan the code with a phone and a handheld scanner.
        </p>
        <PrintNow label="Print test label" />
      </div>
      <div className="mx-auto mt-4 max-w-2xl px-4">
        <LabelSheet faces={[r.face]} />
      </div>
    </main>
  );
}
