import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receive against PO" };

/**
 * Receiving against a purchase order moved to the tablet receive screen (S6, ADR-077): one card per item,
 * PO defaults, details folded under "More details". This old address keeps working for bookmarks and links.
 */
export default async function ReceivePoPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  redirect(`/inventory/receive?po=${encodeURIComponent(poId)}`);
}
