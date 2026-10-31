"use client";
import { useRouter } from "next/navigation";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";

/**
 * Trace and "who got it?" (recall look-up): choose the lot by tapping it, scanning its label (lot, box
 * or batch) or finding it by name, then the page opens with it. Replaces the long lot drop-down and the
 * "scan a label" text box (owner review 2026-10-31: never a typed code).
 */
export function LotPickerNav({ action, candidateParam, scanParam, lots, label }: { action: string; candidateParam: string; scanParam: string; lots: { lotNumber: string; label: string }[]; label: string }) {
  const router = useRouter();
  const candidates: PickCandidate[] = lots.map((l) => {
    const [title, ...rest] = l.label.split(" · ");
    return { value: l.lotNumber, title, detail: rest.join(" · "), code: l.lotNumber, codes: [l.lotNumber] };
  });
  return (
    <ScanOrPick
      mode="emit"
      kind="lot"
      alsoAccept={["container"]}
      id={`nav-${candidateParam}`}
      label={label}
      candidates={candidates}
      candidatesLabel="Lots at your site (newest first)"
      onEmit={(v, c) => router.push(`${action}?${c?.code ? `${candidateParam}=${encodeURIComponent(c.code)}` : `${scanParam}=${encodeURIComponent(v)}`}`)}
    />
  );
}
