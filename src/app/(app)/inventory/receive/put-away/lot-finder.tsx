"use client";
import { useRouter } from "next/navigation";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";

/**
 * Which lot to put away: tap it in the list of lots waiting to be put away, scan its label, or find it by
 * name among those lots only (live audit 2026-10-31: a search over every lot listed ready and expired
 * lots too). The candidate value is the page to open (put-away form, or Move for lots already in boxes).
 */
export function PutAwayLotFinder({ label, candidates }: { label: string; candidates: PickCandidate[] }) {
  const router = useRouter();
  return (
    <ScanOrPick
      kind="lot"
      id="putaway-lot"
      label={label}
      candidates={candidates}
      candidatesLabel={candidates.length ? "QA said OK: these go to their shelf" : undefined}
      onlyCandidates
      maxShown={8}
      onChange={(v) => v && router.push(v)}
    />
  );
}
