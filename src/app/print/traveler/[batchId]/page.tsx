import { SheetPrint } from "../../dispensing-sheet/sheet-print";

export const metadata = { title: "Batch traveler" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { batchId } = await params;
  const { doc } = await searchParams;
  return <SheetPrint batchId={batchId} kind="traveler" docId={doc} />;
}
