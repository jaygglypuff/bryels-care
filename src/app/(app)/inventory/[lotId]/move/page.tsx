import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Superseded (docs/LEGACY_SCREENS.md): moving stock is one screen, Inventory → Move stock, which takes the
 * lot from here (`?lot=`), offers only the shelves the lot may go to and shows boxes and loose stock per
 * shelf. This old address keeps working for bookmarks and old links.
 */
export default async function LotMoveRedirect({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params;
  redirect(`/inventory/move?lot=${encodeURIComponent(lotId)}`);
}
