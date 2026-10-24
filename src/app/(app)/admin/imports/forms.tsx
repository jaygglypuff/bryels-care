"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm, FormMessage } from "@/ui/form";
import { approveAction, decideAction, postAction, rejectAction, returnAction, saveMappingAction, submitAction, validateAction, verifyLegacyAction, voidAction } from "./actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

type KindOption = { kind: string; label: string; available: boolean; unavailableReason: string | null };

/** Step 1 (upload): multipart POST to /api/v1/imports, then opens the new import. */
export function UploadForm({ kinds, sites, currentSiteId }: { kinds: KindOption[]; sites: { id: string; code: string; name: string }[]; currentSiteId: string }) {
  const router = useRouter();
  const key = useRef<string>(newKey());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ActionState>(null);
  const [field, setField] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setField(null);
    try {
      const res = await fetch("/api/v1/imports", { method: "POST", body: new FormData(e.currentTarget), headers: { "Idempotency-Key": key.current } });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; field?: string; jobId?: string };
      if (!res.ok || !body.ok || !body.jobId) {
        setMsg({ ok: false, message: body.message ?? "The upload failed. Nothing was saved." });
        setField(body.field ?? null);
        if (body.field !== "reuploadReason") key.current = newKey();
        return;
      }
      key.current = newKey();
      router.push(`/admin/imports/${body.jobId}`);
    } catch {
      setMsg({ ok: false, message: "The upload failed (connection). Nothing was saved; try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <Field label="What are you importing?" htmlFor="imp-kind">
        <Select id="imp-kind" name="kind" required defaultValue="">
          <option value="" disabled>
            Choose the import kind
          </option>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind} disabled={!k.available}>
              {k.label}
              {k.available ? "" : " (not available yet)"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Site" htmlFor="imp-site" hint="Opening stock and locations load into this site.">
        <Select id="imp-site" name="siteId" defaultValue={currentSiteId}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="File (CSV UTF-8 or .xlsx, up to 20 MB)" htmlFor="imp-file" error={field === "file" ? (msg?.message ?? undefined) : undefined}>
        <Input id="imp-file" name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      </Field>
      <Field label="Saved mapping profile (optional)" htmlFor="imp-map" hint="Code of a profile saved from an earlier file.">
        <Input id="imp-map" name="mappingCode" placeholder="e.g. PURCHASE-LIST" maxLength={64} />
      </Field>
      {field === "reuploadReason" && (
        <div className="sm:col-span-2">
          <Field label="Reason to load the same file again" htmlFor="imp-reason">
            <Input id="imp-reason" name="reuploadReason" required minLength={5} maxLength={1000} />
          </Field>
        </div>
      )}
      <div className="sm:col-span-2 space-y-2">
        <FormMessage state={msg} />
        <Button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload and map columns"}
        </Button>
      </div>
    </form>
  );
}

/** Scans for a legacy documents import (multipart POST; the page is refreshed afterwards, ADR-043 upload case). */
export function ScanUploadForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ActionState>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/imports/${jobId}/scans`, { method: "POST", body: new FormData(form) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; uploaded?: number };
      if (!res.ok || !body.ok) {
        setMsg({ ok: false, message: body.message ?? "The upload failed. Nothing was saved." });
        return;
      }
      form.reset();
      setMsg({ ok: true, message: `${body.uploaded} scan(s) uploaded. Validate the file to match them to its rows.` });
      router.refresh();
    } catch {
      setMsg({ ok: false, message: "The upload failed (connection). Nothing was saved; try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Field label="Scans (PDF, JPEG, PNG; the file names must match the file_name column)" htmlFor="imp-scans">
        <Input id="imp-scans" name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" required />
      </Field>
      <FormMessage state={msg} />
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Uploading…" : "Upload scans"}
      </Button>
    </form>
  );
}

type Col = { key: string; label: string; required?: boolean; hint: string };

/** Step 2 (mapping): template column → file column, formats (A-MIG-04), optional profile save. */
export function MappingForm({ jobId, columns, headers, mapping }: { jobId: string; columns: Col[]; headers: string[]; mapping: { columns: Record<string, string | null>; dateFormat: string; decimalSeparator: string; thousandsSeparator: string } | null }) {
  return (
    <ActionForm action={saveMappingAction} hidden={{ jobId }} submit="Save mapping" pending="Saving…" variant="secondary">
      {(fe) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {columns.map((c) => (
              <Field key={c.key} label={`${c.label}${c.required ? " *" : ""}`} htmlFor={`col-${c.key}`} hint={c.hint} error={fe[`col_${c.key}`]}>
                <Select id={`col-${c.key}`} name={`col_${c.key}`} defaultValue={mapping?.columns?.[c.key] ?? ""}>
                  <option value="">— not in the file —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date format in the file" htmlFor="map-date">
              <Select id="map-date" name="dateFormat" defaultValue={mapping?.dateFormat ?? "DD/MM/YYYY"}>
                <option value="DD/MM/YYYY">DD/MM/YYYY (31/01/2027)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (01/31/2027)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2027-01-31)</option>
              </Select>
            </Field>
            <Field label="Decimal separator" htmlFor="map-dec">
              <Select id="map-dec" name="decimalSeparator" defaultValue={mapping?.decimalSeparator ?? "."}>
                <option value=".">Point (12.5)</option>
                <option value=",">Comma (12,5)</option>
              </Select>
            </Field>
            <Field label="Thousands separator" htmlFor="map-th" error={fe.thousandsSeparator}>
              <Select id="map-th" name="thousandsSeparator" defaultValue={mapping?.thousandsSeparator ?? ","}>
                <option value=",">Comma (1,250)</option>
                <option value=".">Point (1.250)</option>
                <option value=" ">Space (1 250)</option>
                <option value="none">None (1250)</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Save as profile (code, optional)" htmlFor="map-pc" hint="Reuse this mapping for the next file from the same source." error={fe.profileCode ?? fe["profile.code"]}>
              <Input id="map-pc" name="profileCode" maxLength={64} placeholder="e.g. PURCHASE-LIST" />
            </Field>
            <Field label="Profile name" htmlFor="map-pn" error={fe["profile.name"]}>
              <Input id="map-pn" name="profileName" maxLength={120} placeholder="e.g. Purchase list export" />
            </Field>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function ValidateButton({ jobId, label = "Validate the file" }: { jobId: string; label?: string }) {
  return <ActionForm action={validateAction} hidden={{ jobId }} submit={label} pending="Validating…" />;
}

export function DecisionForm({ jobId, rowId, againstFile }: { jobId: string; rowId: string; againstFile: boolean }) {
  return (
    <ActionForm action={decideAction} hidden={{ jobId, rowId }} submit="Save decision" pending="Saving…" variant="secondary" size="sm" className="flex flex-col gap-2">
      <Select name="decision" aria-label="Decision" defaultValue="new_record">
        <option value="same_as_existing">{againstFile ? "Same as that row (skip this one)" : "Same as existing (skip, keep the old name as alias)"}</option>
        <option value="new_record">New record (load it)</option>
        <option value="reject">Reject the row</option>
      </Select>
      <Input name="note" aria-label="Note" placeholder="Note (required to reject)" maxLength={500} />
    </ActionForm>
  );
}

export function SubmitForm({ jobId }: { jobId: string }) {
  return <ActionForm action={submitAction} hidden={{ jobId }} submit="Submit for approval" pending="Submitting…" />;
}

export function ApproveForm({ jobId }: { jobId: string }) {
  return (
    <ActionForm action={approveAction} hidden={{ jobId }} submit="Approve import" pending="Approving…">
      <Field label="Approval note (optional)" htmlFor="ap-note">
        <Input id="ap-note" name="note" maxLength={500} />
      </Field>
    </ActionForm>
  );
}

export function ReasonForm({ jobId, kind }: { jobId: string; kind: "return" | "reject" | "void" }) {
  const cfg = {
    return: { action: returnAction, submit: "Return for changes", confirm: undefined, label: "Why is it returned?" },
    reject: { action: rejectAction, submit: "Close without posting", confirm: "Close this import without posting anything?", label: "Why is it closed?" },
    void: { action: voidAction, submit: "Void the posted import", confirm: "Void this import? Opening stock is reversed by reversal movements; this cannot be undone.", label: "Reason (recorded with every reversal)" },
  }[kind];
  return (
    <ActionForm action={cfg.action} hidden={{ jobId }} submit={cfg.submit} pending="Saving…" variant={kind === "return" ? "secondary" : "danger"} confirm={cfg.confirm}>
      <Field label={cfg.label} htmlFor={`rs-${kind}`}>
        <Textarea id={`rs-${kind}`} name="reason" required minLength={5} maxLength={1000} rows={2} />
      </Field>
    </ActionForm>
  );
}

export function PostForm({ jobId, label }: { jobId: string; label: string }) {
  return <ActionForm action={postAction} hidden={{ jobId }} submit={label} pending="Posting…" confirm="Post this import now? Posted records are only corrected by reversal." />;
}

export function VerifyForm({ documentId }: { documentId: string }) {
  return (
    <ActionForm action={verifyLegacyAction} hidden={{ documentId }} submit="Verify index" pending="Saving…" variant="secondary" size="sm" className="flex flex-col gap-2">
      <Input name="note" aria-label="Verification note" placeholder="Note (optional)" maxLength={500} />
    </ActionForm>
  );
}
