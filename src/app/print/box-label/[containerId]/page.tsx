import { redirect } from "next/navigation";

/**
 * Box labels are label jobs like every other label (ADR-099): recorded, audited, and a second copy is a reprint
 * with a reason. This URL (box page "Print box label") opens the label screen for the box: the label as it
 * prints, how many, and one Print button.
 */
export default async function BoxLabelPage({ params }: { params: Promise<{ containerId: string }> }) {
  const { containerId } = await params;
  redirect(`/labels/new?entityType=container&entityId=${encodeURIComponent(containerId)}`);
}
