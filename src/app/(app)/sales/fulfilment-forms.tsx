"use client";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, Select, Textarea, type ButtonVariant } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { Scanner } from "@/ui/scanner";
import type { ScanActionResult, ScanOptions } from "./fulfilment-actions";

/**
 * Client pieces of the W3E fulfilment screens: the shared in-place command form (ADR-043), the scan
 * panels for pick / pack verification / pack check (camera, wedge or typed; each scan carries its
 * own idempotency key and the server re-renders the page with the new progress) and the delivery
 * receipt acknowledgment with a drawn signature or a photo.
 */

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function Cmd({ action, fields, label, pending = "Working…", variant = "primary", size = "md", confirm, children }: { action: Action; fields: Record<string, string>; label: string; pending?: string; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; confirm?: string; children?: ReactNode | ((fe: Record<string, string>) => ReactNode) }) {
  return (
    <ActionForm action={action} hidden={fields} submit={label} pending={pending} variant={variant} size={size} confirm={confirm} className="flex min-w-0 flex-col gap-3" messageBelow>
      {children}
    </ActionForm>
  );
}

/** A reason text field for the controlled undo commands. */
export function ReasonCmd({ action, fields, label, placeholder, confirm, variant = "secondary" }: { action: Action; fields: Record<string, string>; label: string; placeholder: string; confirm?: string; variant?: ButtonVariant }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        {label}…
      </Button>
    );
  return (
    <Cmd action={action} fields={fields} label={label} variant={variant} confirm={confirm}>
      {(fe) => (
        <Field label="Reason" htmlFor={`reason-${label}`} error={fe.reason}>
          <Input id={`reason-${label}`} name="reason" required minLength={3} maxLength={300} placeholder={placeholder} />
        </Field>
      )}
    </Cmd>
  );
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

type ScanFn = (payload: string, opts: ScanOptions, key: string) => Promise<ScanActionResult>;

/**
 * Scan panel. `withQty`: a lot scan (BC:LOT) asks for the counted quantity first. `allowManual`: a
 * typed number can be flagged as manual entry with a reason (label unreadable). `labelCheck`: the
 * checker can mark a box's label as wrong.
 */
export function ScanPanel({ scan, label, hint, withQty = false, allowManual = false, labelCheck = false }: { scan: ScanFn; label: string; hint: string; withQty?: boolean; allowManual?: boolean; labelCheck?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ScanActionResult | null>(null);
  const [qty, setQty] = useState("");
  const [manual, setManual] = useState("");
  const [labelBad, setLabelBad] = useState(false);
  const [offline, setOffline] = useState(false);
  const last = useRef<{ payload: string; key: string } | null>(null);
  const onScan = useCallback(
    (value: string) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setOffline(true);
        return;
      }
      setOffline(false);
      const isLot = value.startsWith("BC:LOT:");
      if (withQty && isLot && !/^\d+(\.\d+)?$/.test(qty.trim())) {
        setResult({ ok: false, tone: "warn", message: "That is a lot label: first type how many loose pieces you counted, then scan the lot label again." });
        return;
      }
      const sig = `${value}|${qty}|${manual}|${labelBad}`;
      if (!last.current || last.current.payload !== sig) last.current = { payload: sig, key: newKey() };
      const k = last.current.key;
      start(async () => {
        const r = await scan(value, { qty: isLot ? qty.trim() : null, manualEntryReason: manual.trim() || null, labelOk: !labelBad }, k);
        setResult(r);
        if (r.ok) {
          last.current = null;
          if (isLot) setQty("");
          setManual("");
          setLabelBad(false);
        }
      });
    },
    [scan, qty, manual, labelBad, withQty],
  );
  const tone = result?.tone === "ok" ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : result?.tone === "warn" ? "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Scanner onScan={onScan} pending={pending} label={label} placeholder="BC:BOX:BX-00000012 · BC:LOT:L-2610-00015" />
      <p className="text-[12px] text-muted">{hint}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {withQty && (
          <Field label="How many loose pieces (only for a lot label)" htmlFor="scan-qty" hint="Leave empty for boxes">
            <Input id="scan-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 6" />
          </Field>
        )}
        {allowManual && (
          <Field label="Label cannot be read? Say why you type it" htmlFor="scan-manual" hint="Saved as typed by hand">
            <Input id="scan-manual" value={manual} onChange={(e) => setManual(e.target.value)} maxLength={200} placeholder="e.g. Label torn" />
          </Field>
        )}
        {labelCheck && (
          <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
            <input type="checkbox" checked={labelBad} onChange={(e) => setLabelBad(e.target.checked)} className="h-5 w-5" />
            The next box has the wrong label
          </label>
        )}
      </div>
      {offline && <p role="alert" className="rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">No internet. Scans need a connection: scan again when the phone is back online.</p>}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`rounded-[10px] border px-3 py-2 text-[14px] ${tone}`} data-testid="scan-result">
          {result.message}
        </p>
      )}
    </div>
  );
}

/** Drawn signature on a canvas, attached to the form as a PNG file (evidence, not an e-signature). */
function SignaturePad({ inputName }: { inputName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.strokeStyle = "#111";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const save = () => {
    canvas.current!.toBlob((b) => {
      if (!b || !file.current) return;
      const dt = new DataTransfer();
      dt.items.add(new File([b], "signature.png", { type: "image/png" }));
      file.current.files = dt.files;
    }, "image/png");
  };
  const clear = () => {
    const c = canvas.current!;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
    if (file.current) file.current.value = "";
  };
  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        width={600}
        height={200}
        aria-label="Signature box: the person receiving signs here"
        className="h-[140px] w-full touch-none rounded-[12px] border border-line bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const g = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          g.beginPath();
          g.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          g.lineTo(p.x, p.y);
          g.stroke();
          setHasInk(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          save();
        }}
      />
      <input ref={file} type="file" name={inputName} accept="image/png" className="hidden" tabIndex={-1} aria-hidden="true" />
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span>{hasInk ? "Signature saved." : "Ask the person receiving to sign with a finger."}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

export function AcknowledgeForm({ action, shipmentId, now }: { action: Action; shipmentId: string; now: string }) {
  const [kind, setKind] = useState<"drawn" | "photo" | "name_only">("drawn");
  return (
    <ActionForm action={action} hidden={{ shipmentId }} submit="Save proof of delivery" pending="Saving…" variant="cta" size="lg" className="flex min-w-0 flex-col gap-3" messageBelow>
      {(fe) => (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Who received it (name)" htmlFor="receivedByName" error={fe.receivedByName}>
              <Input id="receivedByName" name="receivedByName" required maxLength={120} />
            </Field>
            <Field label="When" htmlFor="receivedAt" error={fe.receivedAt} hint="Philippine time">
              <Input id="receivedAt" name="receivedAt" type="datetime-local" max={now} defaultValue={now} required />
            </Field>
            <Field label="Proof" htmlFor="kind" error={fe.kind}>
              <Select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="drawn">Signature drawn on this device</option>
                <option value="photo">Photo of the signed paper copy</option>
                <option value="name_only">Name only (no signature image)</option>
              </Select>
            </Field>
          </div>
          {kind === "drawn" && <SignaturePad inputName="file" />}
          {kind === "photo" && (
            <Field label="Photo of the signed copy" htmlFor="file" error={fe.file} hint="JPEG, PNG or WebP">
              <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="block w-full text-[14px]" />
            </Field>
          )}
          {fe.file && kind === "drawn" && <p className="text-[13px] text-[var(--bad-fg)]">{fe.file}</p>}
          <Field label="Anything wrong? (missing, damaged or refused boxes)" htmlFor="remarks" error={fe.remarks}>
            <Textarea id="remarks" name="remarks" maxLength={600} rows={2} />
          </Field>
          <MoreDetails title="Their job (you can skip this)" open={!!fe.receivedByPosition}>
            <Field label="Their job (optional)" htmlFor="receivedByPosition" error={fe.receivedByPosition}>
              <Input id="receivedByPosition" name="receivedByPosition" maxLength={80} placeholder="e.g. Store supervisor" />
            </Field>
          </MoreDetails>
          <p className="text-[12px] text-muted">This shows the customer got the goods. It is not an electronic signature.</p>
        </>
      )}
    </ActionForm>
  );
}
