"use client";
import { Printer } from "lucide-react";
import { Button } from "@/ui/core";

/** Browser print of the customer copy (ADR-026); "Save as PDF" in the print dialog downloads it. */
export function PrintButton() {
  return (
    <Button type="button" variant="cta" onClick={() => window.print()} className="no-print">
      <Printer size={16} aria-hidden="true" /> Print or save as PDF
    </Button>
  );
}
