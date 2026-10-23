"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex min-h-[44px] items-center rounded-[10px] bg-[#1c1b18] px-4 text-[14px] font-medium text-white hover:bg-black"
    >
      Print / save as PDF
    </button>
  );
}
