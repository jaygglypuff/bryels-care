"use client";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, Select, Textarea, type ButtonVariant } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { ScanOrPick, type PickCandidate, type PickVia } from "@/ui/scan-or-pick";
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

const LOT_LABEL = /^BC:LOT:/i;

/**
 * Scan panel (ScanOrPick in emit mode). The camera button, a handheld scanner or the number typed off the label
 * (owner decision 2026-11-08, recorded as typed) sends each label. `withQty`: a LOT label (loose pieces) asks
 * "How many loose pieces of this lot?" right after it is scanned or typed, then sends both; a box never asks.
 * `candidates`: the boxes and lots expected (typed last digits are matched against them); `allowManual` (picking):
 * they can also be TAPPED when a label will not scan; a tap is saved as "by hand" with a reason (audited).
 * Without `allowManual` (second check, pack check) the list is not tappable: the checker scans or types the label.
 * `showCandidates={false}`: the page lists them itself (second check). `labelCheck`: mark a box's label as wrong.
 */
export function ScanPanel({
  scan,
  label,
  hint,
  withQty = false,
  allowManual = false,
  labelCheck = false,
  candidates = [],
  showCandidates = true,
  qtyAction = "Check these pieces",
  allowTyping = true,
}: {
  scan: ScanFn;
  label: string;
  hint: string;
  withQty?: boolean;
  allowManual?: boolean;
  labelCheck?: boolean;
  candidates?: PickCandidate[];
  showCandidates?: boolean;
  /** Button that sends a lot label with the counted pieces. */
  qtyAction?: string;
  /** ADR-126: false hides "type the number" (checks while `scan.typed_code_counts_as_check` is off). */
  allowTyping?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ScanActionResult | null>(null);
  const [qty, setQty] = useState("");
  /** A lot label scanned or typed: waits for the counted loose pieces. */
  const [lot, setLot] = useState<{ value: string; via: PickVia; name: string } | null>(null);
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [labelBad, setLabelBad] = useState(false);
  const [offline, setOffline] = useState(false);
  const last = useRef<{ payload: string; key: string } | null>(null);
  const send = useCallback(
    (value: string, via: PickVia, pieces: string | null) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setOffline(true);
        return;
      }
      setOffline(false);
      // A tap is never a scan: it is saved as entered by hand, with the reason. A typed number is saved as typed.
      const manualReason = via === "tap" ? manual.trim() || "Label would not scan: tapped in the list" : "";
      const sig = `${value}|${pieces ?? ""}|${via}|${manualReason}|${labelBad}`;
      if (!last.current || last.current.payload !== sig) last.current = { payload: sig, key: newKey() };
      const k = last.current.key;
      start(async () => {
        const r = await scan(value, { qty: pieces, manualEntryReason: manualReason || null, labelOk: !labelBad, via }, k);
        // A lot number that was not in the list: the server says it needs the counted pieces.
        if (!r.ok && r.code === "NEEDS_QTY" && withQty && !pieces) {
          setResult(null);
          setLot({ value, via, name: r.lotNumber ? `lot ${r.lotNumber}` : value.replace(LOT_LABEL, "lot ") });
          return;
        }
        setResult(r);
        if (r.ok) {
          last.current = null;
          setLot(null);
          setQty("");
          setManual("");
          setLabelBad(false);
        }
      });
    },
    [scan, manual, labelBad, withQty],
  );
  const onScan = useCallback(
    (value: string, c: PickCandidate | null, via: PickVia) => {
      setQtyError(null);
      if (withQty && LOT_LABEL.test(value)) {
        // Owner screenshot 2026-11-08: the pieces are asked only after a lot label, never before.
        setResult(null);
        setQty("");
        setLot({ value, via, name: c ? `${c.title} · lot ${value.slice(7)}` : `lot ${value.slice(7)}` });
        return;
      }
      setLot(null);
      send(value, via, null);
    },
    [withQty, send],
  );
  const sendPieces = () => {
    if (!lot) return;
    if (!/^\d+(\.\d+)?$/.test(qty.trim()) || Number(qty) <= 0) return setQtyError("Type how many loose pieces you counted, for example 6.");
    setQtyError(null);
    send(lot.value, lot.via, qty.trim());
  };
  const tone = result?.tone === "ok" ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : result?.tone === "warn" ? "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ScanOrPick
        mode="emit"
        kind="container"
        alsoAccept={["lot"]}
        id="scan-panel"
        label={label}
        hint={hint}
        candidates={candidates}
        showCandidates={showCandidates}
        candidatesLabel={candidates.length ? (allowManual ? "Still to take (tap one only if its label will not scan)" : "Still to check") : undefined}
        allowTap={allowManual}
        allowTyping={allowTyping}
        search={false}
        pending={pending}
        onEmit={onScan}
      />
      {lot && (
        <div className="flex flex-col gap-2 rounded-[14px] border-2 border-primary bg-primary-soft p-3" data-testid="loose-qty">
          <p className="text-[14px] text-fg-2">
            {lot.via === "typed" ? "Typed" : lot.via === "tap" ? "Chosen" : "Scanned"}: <strong className="text-fg">{lot.name}</strong> (loose pieces)
          </p>
          <Field label="How many loose pieces of this lot?" htmlFor="scan-qty" error={qtyError ?? undefined}>
            <Input
              id="scan-qty"
              inputMode="numeric"
              enterKeyHint="done"
              autoComplete="off"
              autoFocus
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendPieces();
                }
              }}
              placeholder="e.g. 6"
              className="min-h-[52px] text-[18px]"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="cta" size="lg" disabled={pending} onClick={sendPieces} data-testid="loose-qty-send">
              {pending ? "Checking…" : qtyAction}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => setLot(null)}>
              Not this lot
            </Button>
          </div>
        </div>
      )}
      {(allowManual || labelCheck) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allowManual && (
            <Field label="Label will not scan? Say why, then tap it in the list" htmlFor="scan-manual" hint="Saved as entered by hand">
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
      )}
      {offline && <p role="alert" className="rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">No internet. Checks need a connection: scan or type it again when the phone is back online.</p>}
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
