"use client";
import { buttonClass } from "@/ui/core";

export function PrintButton() {
  return (
    <button type="button" className={buttonClass("secondary", "sm") + " no-print"} onClick={() => window.print()}>
      Print
    </button>
  );
}
