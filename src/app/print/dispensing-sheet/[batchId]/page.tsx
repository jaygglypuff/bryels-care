import { SheetPrint } from "../sheet-print";

export const metadata = { title: "Dispensing sheet" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { batchId } = await params;
  const { doc } = await searchParams;
  return <SheetPrint batchId={batchId} kind="dispensing_sheet" docId={doc} />;
}
