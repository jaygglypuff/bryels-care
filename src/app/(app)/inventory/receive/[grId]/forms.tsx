"use client";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, Select } from "@/ui/core";
import { ActionForm as SharedActionForm } from "@/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * A small server-action form: hidden fields, optional inputs, a submit button and the result message.
 * `confirm` asks before irreversible commands (post, reverse, cancel). The shared in-place
 * ActionForm (ADR-043) with this module's layout: the action's response re-renders the page.
 */
export function ActionForm({
  action,
  hidden,
  submit,
  pendingText,
  variant = "primary",
  confirm,
  children,
  className,
}: {
  action: Action;
  hidden: Record<string, string>;
  submit: string;
  pendingText?: string;
  variant?: "primary" | "secondary" | "cta" | "danger" | "ghost";
  confirm?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <SharedActionForm action={action} hidden={hidden} submit={submit} pending={pendingText ?? "Working…"} variant={variant} confirm={confirm} className={className ?? "space-y-3"}>
      {children}
    </SharedActionForm>
  );
}

export function ReasonField({ id, name = "reason", label = "Reason", placeholder }: { id: string; name?: string; label?: string; placeholder?: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} name={name} required minLength={5} maxLength={1000} placeholder={placeholder} autoComplete="off" />
    </Field>
  );
}

const KINDS = [
  ["coa", "Certificate of analysis (CoA)"],
  ["sds", "Safety data sheet (SDS)"],
  ["specification", "Specification"],
  ["photo", "Photo"],
  ["other", "Other document"],
] as const;

/**
 * Upload with progress (XMLHttpRequest so the bar moves on slow phone networks). The server validates
 * type, size and scope; nothing is shown as uploaded until the server confirms.
 */
export function UploadWidget({ entityType, entityId, header = false, idPrefix }: { entityType: "goods_receipt" | "goods_receipt_line"; entityId: string; header?: boolean; idPrefix: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(header ? "photo" : "coa");
  const [docNo, setDocNo] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function send() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg({ ok: false, text: "Choose a photo or PDF first." });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("entityType", entityType);
    fd.set("entityId", entityId);
    fd.set("documentKind", kind);
    fd.set("documentNumber", docNo);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/files");
    xhr.setRequestHeader("Idempotency-Key", crypto.randomUUID());
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      let body: { message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        setMsg({ ok: true, text: `${file.name} attached.` });
        if (fileRef.current) fileRef.current.value = "";
        setDocNo("");
        // A REST upload has no server-action response to carry the page: refresh it (ADR-043).
        router.refresh();
      } else {
        setMsg({ ok: false, text: body.message ?? `Upload failed (HTTP ${xhr.status}). Nothing was attached.` });
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setMsg({ ok: false, text: "The upload did not reach the server. Check the connection and try again." });
    };
    setMsg(null);
    setProgress(0);
    xhr.send(fd);
  }

  return (
    <div className="space-y-3 rounded-[12px] border border-dashed border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {!header && (
          <Field label="Document type" htmlFor={`${idPrefix}-kind`}>
            <Select id={`${idPrefix}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </Select>
          </Field>
        )}
        {!header && (
          <Field label="Document no. (optional)" htmlFor={`${idPrefix}-no`}>
            <Input id={`${idPrefix}-no`} value={docNo} onChange={(e) => setDocNo(e.target.value)} maxLength={80} />
          </Field>
        )}
        <Field label={header ? "Photo of the supplier's delivery document" : "File"} htmlFor={`${idPrefix}-file`} hint="JPEG, PNG, WebP up to 10 MB or PDF up to 25 MB. Photo location data is removed.">
          <Input id={`${idPrefix}-file`} ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture={header ? "environment" : undefined} />
        </Field>
      </div>
      {progress !== null && (
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-[13px] text-[var(--ok-fg)]" : "text-[13px] text-[var(--bad-fg)]"}>{msg.text}</p>}
      <Button type="button" variant="secondary" size="sm" onClick={send} disabled={progress !== null}>
        <Upload size={14} /> {progress !== null ? `Uploading… ${progress}%` : "Upload"}
      </Button>
    </div>
  );
}
