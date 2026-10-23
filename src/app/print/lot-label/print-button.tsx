"use client";
import { Printer } from "lucide-react";
import { buttonClass } from "@/ui/core";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("cta", "lg") + " no-print"}>
      <Printer size={18} /> {label}
    </button>
  );
}
