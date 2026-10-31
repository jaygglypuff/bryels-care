import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, Clock, FileClock, HelpCircle, Lock, PauseCircle, XCircle } from "lucide-react";
import { Chip } from "@/ui/status";
import { STEP_KIND_WORDS } from "@/modules/masterdata";

/**
 * Grade-5 words for the recipe "advanced editing" screens (ADR-088): products, sellable items,
 * recipes (advanced), steps (advanced) and how-to sheets. Stored values, statuses and codes are
 * unchanged; only what people read is plain. Server-safe (no hooks).
 */

/** "What is this?" for words that are not in the shared `EXPLAIN` list (same look as `Explain`). */
export function WhatIs({ children, label = "What is this?" }: { children: ReactNode; label?: string }) {
  return (
    <details className="inline-block align-middle">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-primary-text [&::-webkit-details-marker]:hidden">
        <HelpCircle size={14} aria-hidden /> {label}
      </summary>
      <p className="mt-1 max-w-[46ch] rounded-[12px] border border-line bg-surface p-3 text-[14px] font-normal text-fg-2">{children}</p>
    </details>
  );
}

export const SELLABLE_ITEM_TEXT =
  "A sellable item is one way the product is packed and sold: one bar, a box of 12, a gift set. Each has its own barcode and price. In the system it is called an SKU.";

/** Version status in plain words with an icon (never colour alone). label = derived effective/scheduled/superseded. */
export function PlainVersionChip({ status, label }: { status: string; label?: string }) {
  const l = label ?? status;
  if (status === "approved" && l === "effective") return <Chip tone="ok"><CheckCircle2 size={13} aria-hidden /> In use</Chip>;
  if (status === "approved" && l === "scheduled") return <Chip tone="info"><Clock size={13} aria-hidden /> Approved, starts later</Chip>;
  if (status === "approved" && l === "superseded") return <Chip tone="exp"><FileClock size={13} aria-hidden /> Old version</Chip>;
  if (status === "approved") return <Chip tone="ok"><CheckCircle2 size={13} aria-hidden /> Approved</Chip>;
  if (status === "pending_approval") return <Chip tone="appr"><PauseCircle size={13} aria-hidden /> Waiting for OK</Chip>;
  if (status === "rejected") return <Chip tone="rej"><XCircle size={13} aria-hidden /> Not OK&apos;d</Chip>;
  if (status === "retired") return <Chip tone="neu"><Lock size={13} aria-hidden /> No longer used</Chip>;
  return <Chip tone="neu"><CircleDashed size={13} aria-hidden /> Draft</Chip>;
}

/** Product and sellable-item status in plain words. */
export function PlainItemChip({ status }: { status: string }) {
  if (status === "active") return <Chip tone="ok"><CheckCircle2 size={13} aria-hidden /> Ready to use</Chip>;
  if (status === "discontinued") return <Chip tone="neu"><Lock size={13} aria-hidden /> No longer made</Chip>;
  return <Chip tone="neu"><CircleDashed size={13} aria-hidden /> Draft</Chip>;
}

/** "1 Jan 2027" or "today" style use-from text for a version. */
export function useFromText(from: string | null, to: string | null, fmt: (d: string) => string): string {
  if (!from) return "Use from: not set yet";
  return to ? `Used ${fmt(from)} to ${fmt(to)}` : `Use from ${fmt(from)}`;
}

/** Step kinds in plain words: the recipe wizard's words (one source, recipe-blocks.ts). */
export const stepKindWords = (k: string) => STEP_KIND_WORDS[k] ?? k.replace(/_/g, " ");

/** Keeps the "What to do next" sentence at least ~260 px wide so a long button label wraps below it on a phone. */
export const NEXT_WRAP = "[&>div:first-child]:min-w-[min(100%,260px)]";
