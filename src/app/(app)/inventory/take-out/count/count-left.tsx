"use client";
import Link from "next/link";
import { startTransition, useState, useTransition } from "react";
import { Button, Field, Input, Select, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { useRenewableClientKey } from "@/ui/use-client-key";
import type { CountLeftResult } from "@/modules/inventory";
import { countLeftAction } from "../actions";

type Row = { key: string; containerId: string | null; lotId: string; locationId: string; title: string; productName: string; detail: string; pieces: string; last: string; days: number; stale: boolean };

/** The places to count (quiet ones first) and the count form of the chosen one. */
export function CountLeft({ rows, selected, reasons, canFix }: { rows: Row[]; selected: string | null; reasons: { code: string; label: string; requiresNote: boolean }[]; canFix: boolean }) {
  const [open, setOpen] = useState<string | null>(selected && rows.some((r) => r.key === selected) ? selected : null);
  return (
    <ul className="flex flex-col gap-2" aria-label="Places to count" data-testid="count-left-list">
      {rows.map((r) => (
        <li key={r.key} className={cx("rounded-[8px] border bg-surface", r.stale ? "border-[var(--warn-bd)]" : "border-line")}>
          <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key} className="flex min-h-[64px] w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">
                {r.productName} · {r.title}
              </span>
              <span className="block text-[13px] text-fg-2">{r.detail}</span>
              <span className="block text-[13px] text-muted">{r.last}</span>
            </span>
            <span className="flex items-center gap-2">
              {r.stale && <Chip tone="warn">Not counted for {r.days} days</Chip>}
              <span className="text-[18px] font-semibold tabular-nums">{r.pieces}</span>
            </span>
          </button>
          {open === r.key && <CountForm row={r} reasons={reasons} canFix={canFix} onDone={() => undefined} />}
        </li>
      ))}
    </ul>
  );
}

function CountForm({ row, reasons, canFix }: { row: Row; reasons: { code: string; label: string; requiresNote: boolean }[]; canFix: boolean; onDone: () => void }) {
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState(reasons.find((r) => r.code === "unrecorded_takeout")?.code ?? "");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<CountLeftResult | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [key, renew] = useRenewableClientKey();
  const [busy, start] = useTransition();
  const diff = /^\d+$/.test(counted) ? Number(counted) - Number(row.pieces) : null;
  const needsNote = reasons.find((r) => r.code === reason)?.requiresNote ?? false;
  if (result)
    return (
      <div className="border-t border-line px-4 py-3" role="status" data-testid="count-result">
        {result.adjustmentNumber ? (
          <Banner tone="warn" title={`Sent to the site manager · ${result.adjustmentNumber}`}>
            You counted {result.counted}; the app had {result.expected} ({Number(result.difference) > 0 ? "+" : ""}
            {result.difference}). Stock changes when the manager says OK and saves it.{" "}
            <Link href={`/inventory/adjustments/${result.adjustmentId}`} className="font-medium text-primary-text underline">
              Open the stock fix
            </Link>
          </Banner>
        ) : (
          <Banner tone="ok" title="Counted. It matches.">
            {result.counted} pieces, as the app says.
          </Banner>
        )}
        <Button type="button" variant="secondary" className="mt-2" onClick={() => { setResult(null); setCounted(""); renew(); }}>
          Count again
        </Button>
      </div>
    );
  return (
    <div className="space-y-3 border-t border-line px-4 py-3">
      {error && (
        <Banner tone="bad" title="Not saved">
          {error.message}
        </Banner>
      )}
      <Field label="How many pieces do you count?" htmlFor={`count-${row.key}`} error={error?.fields.counted} hint={`The app says ${row.pieces}.`}>
        <Input id={`count-${row.key}`} inputMode="numeric" pattern="[0-9]*" className="w-32 text-[18px] font-semibold tabular-nums" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^0-9]/g, "").slice(0, 7))} autoFocus />
      </Field>
      {diff !== null && diff !== 0 && (
        <div className="space-y-3 rounded-[8px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3" data-testid="count-difference">
          <p className="text-[14px] font-semibold">
            {diff < 0 ? `${-diff} missing` : `${diff} more than the app says`}.
          </p>
          {canFix ? (
            <>
              <Field label="Why?" htmlFor={`reason-${row.key}`} error={error?.fields.reasonCode}>
                <Select id={`reason-${row.key}`} value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose why</option>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={needsNote ? "Say what happened" : "Note (optional)"} htmlFor={`note-${row.key}`} error={error?.fields.reasonNote ?? error?.fields.note}>
                <Input id={`note-${row.key}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="For example: 2 Lazada orders on Friday" />
              </Field>
              <p className="text-[13px] text-fg-2">This sends a stock fix to the site manager. Stock changes only after the OK.</p>
            </>
          ) : (
            <p className="text-[14px]">Ask the warehouse or the site manager to count it and fix the stock.</p>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="cta"
        disabled={busy || counted === "" || !key || (diff !== 0 && (!canFix || !reason || (needsNote && note.trim().length < 3)))}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await countLeftAction({ containerId: row.containerId, lotId: row.lotId, locationId: row.containerId ? null : row.locationId, counted, reasonCode: diff ? reason : null, note: note || null, idempotencyKey: key });
            startTransition(() => (r.ok ? setResult(r.result) : setError({ message: r.message, fields: r.fieldErrors ?? {} })));
          })
        }
        data-testid="count-save"
      >
        {busy ? "Saving…" : diff === 0 ? "It matches" : diff === null ? "Save the count" : "Send the difference"}
      </Button>
    </div>
  );
}
