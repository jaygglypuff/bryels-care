"use client";
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex min-h-[44px] items-center rounded-[10px] bg-cta px-4 text-[14px] font-medium text-white hover:bg-black"
    >
      Print or save as PDF
    </button>
  );
}
