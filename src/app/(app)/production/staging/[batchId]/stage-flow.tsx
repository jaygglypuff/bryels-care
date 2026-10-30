"use client";
import { startTransition, useEffect, useRef, useState, useTransition } from "react";
import { MapPin, ScanLine } from "lucide-react";
import { Button, Card, inputClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { stageMaterialAction, type StageResult } from "../../work-orders/actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * Scanner flow for staging (phone + keyboard-wedge scanner): scan the lot, scan the staging
 * location, optional quantity (defaults to what the ingredient still needs), confirm. A wrong or
 * unreserved lot comes back blocked with the expected lots; nothing is posted.
 */
export function StageFlow({ batchId, stagingLocations }: { batchId: string; stagingLocations: { id: string; code: string; name: string }[] }) {
  const lotRef = useRef<HTMLInputElement>(null);
  const [lot, setLot] = useState("");
  const [loc, setLoc] = useState(stagingLocations.length === 1 ? `BC:LOC:${stagingLocations[0].code}` : "");
  const [qty, setQty] = useState("");
  const [key, setKey] = useState(newKey);
  const [result, setResult] = useState<StageResult | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => lotRef.current?.focus(), []);

  const submit = () =>
    start(async () => {
      // The action's response re-renders the staging page (refreshCurrentPage, ADR-043). Updates
      // after the await are wrapped again so they join that transition: the result and the
      // refreshed pick list commit together.
      const r = await stageMaterialAction({ batchId, lotCode: lot, toLocationCode: loc, qty, idempotencyKey: key });
      startTransition(() => {
        setResult(r);
        if (r.ok) {
          setKey(newKey());
          setLot("");
          setQty("");
        }
      });
      if (r.ok) lotRef.current?.focus();
    });

  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (lot.trim() && loc.trim()) submit();
        }}
      >
        <label htmlFor="lotCode" className="flex items-center gap-2 text-[14px] font-semibold">
          <ScanLine size={16} /> 1. Scan the lot (container label)
        </label>
        <input
          ref={lotRef}
          id="lotCode"
          value={lot}
          onChange={(e) => setLot(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="BC:LOT:L-2610-00042"
          className={`${inputClass} min-h-[52px] font-mono text-[16px]`}
          aria-invalid={!!result?.fieldErrors?.lotCode}
        />
        <label htmlFor="toLocationCode" className="flex items-center gap-2 text-[14px] font-semibold">
          <MapPin size={16} /> 2. Scan the staging location
        </label>
        <input
          id="toLocationCode"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={stagingLocations[0] ? `BC:LOC:${stagingLocations[0].code}` : "BC:LOC:…"}
          className={`${inputClass} min-h-[52px] font-mono text-[16px]`}
        />
        {stagingLocations.length > 0 && <p className="text-[12px] text-muted">Staging areas: {stagingLocations.map((l) => `${l.code} (${l.name})`).join(", ")}</p>}
        <label htmlFor="qty" className="text-[13px] font-medium">
          Quantity (optional, base unit; empty = what the ingredient still needs)
        </label>
        <input id="qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputClass} />
        <Button type="submit" variant="cta" size="lg" disabled={pending || !lot.trim() || !loc.trim()}>
          {pending ? "Posting…" : "Confirm staging"}
        </Button>
        {result && (
          <div role={result.ok ? "status" : "alert"} aria-live="polite">
            <Banner tone={result.ok ? "ok" : "bad"} title={result.ok ? (result.batchStaged ? "Batch fully staged" : "Staged") : "Not staged"}>
              {result.message}
            </Banner>
          </div>
        )}
      </form>
    </Card>
  );
}

/**
 * One tap per reserved lot (owner feedback 2026-10-25): no typing of lot numbers. Moves what the
 * ingredient still needs (or the whole reserved quantity if less) to the staging area; the server
 * re-checks the lot, the reservation and the quantity.
 */
export function StageLotButton({ batchId, lotNumber, qty, toLocationCode, label }: { batchId: string; lotNumber: string; qty: string; toLocationCode: string | null; label: string }) {
  const [key, setKey] = useState(newKey);
  const [result, setResult] = useState<StageResult | null>(null);
  const [pending, start] = useTransition();
  if (!toLocationCode) return null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="cta"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await stageMaterialAction({ batchId, lotCode: lotNumber, toLocationCode, qty, idempotencyKey: key });
            startTransition(() => {
              setResult(r);
              if (r.ok) setKey(newKey());
            });
          })
        }
      >
        {pending ? "Moving…" : label}
      </Button>
      {result && !result.ok && (
        <p role="alert" className="text-[12.5px] text-[var(--bad-fg)]">
          {result.message}
        </p>
      )}
    </div>
  );
}
