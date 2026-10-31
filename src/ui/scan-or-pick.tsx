"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, Search, X } from "lucide-react";
import { resolvePickAction, searchPickAction } from "@/app/(app)/scan-pick-actions";
import { classifyPickInput, filterCandidates, isScannerBurst, missingMessage, notFoundMessage, PICK_WORDS, submitValue, type PickCandidate, type PickKind } from "@/lib/scan/pick";
import { Button, cx, inputClass } from "./core";
import { Scanner } from "./scanner";
import { Chip } from "./status";

export type { PickCandidate, PickKind } from "@/lib/scan/pick";

/**
 * ScanOrPick: the one way to say WHICH lot, box, shelf, batch or item anywhere in the app
 * (owner review 2026-10-31; ADR-088 "no user ever types a code"; docs/SCAN_INPUTS.md).
 *
 *  (a) the EXPECTED candidates as big tap targets (lots set aside for this batch, shelves holding this
 *      lot, boxes on this shelf). Tapping fills the value.
 *  (b) a "Scan" button that opens the camera; a handheld (keyboard-wedge) scanner works at any time
 *      without tapping anything: the burst goes to the first field on the page still waiting.
 *  (c) "Find by name": words (coconut oil), never a code box.
 *
 * The form value lives in a hidden input `name` and is only ever a tapped/scanned/found candidate's
 * value (or code with submit="code"): the placeholder can never be submitted, and a required field
 * blocks its form with a plain message until something is chosen. Servers still accept a label
 * payload (BC:LOT:…), a plain number or a candidate id, and check site and permission again.
 *
 * mode="emit" (verification panels: picking, second check): every tap/scan is handed to `onEmit`
 * and the field stays ready for the next one; `allowTap={false}` shows the list as a checklist only.
 */

type Base = {
  kind: PickKind;
  /** The question: "Which lot?", "Which shelf?". */
  label: string;
  id?: string;
  /** Expected candidates (big tap targets). */
  candidates?: PickCandidate[];
  /** Heading above the candidates, e.g. "Set aside for this batch". */
  candidatesLabel?: string;
  hint?: string;
  error?: string | null;
  /** Words fallback (server search). Off for offline screens. */
  search?: boolean;
  /** Tapping candidates allowed (false: verification by scan only). */
  allowTap?: boolean;
  /** A scanned label must be one of the candidates (no server look-up). */
  onlyCandidates?: boolean;
  /** How many candidates show before "Show all". */
  maxShown?: number;
  /** Label kinds accepted besides `kind` (move: a lot or a box). The caller resolves them (mode="emit"). */
  alsoAccept?: PickKind[];
  /** Hardware scanner bursts with nothing focused land here (default true). */
  listen?: boolean;
  className?: string;
};

type SelectProps = Base & {
  mode?: "select";
  /** Hidden input name for forms. */
  name?: string;
  /** Submit the candidate's value (id, default) or its number/code. */
  submit?: "value" | "code";
  defaultValue?: string | null;
  /** Controlled: pass null/"" to clear. */
  value?: string | null;
  /** `via`: "tap" (tapped in the list or found by name) or "scan" (camera, handheld scanner). */
  onChange?: (value: string | null, candidate: PickCandidate | null, via?: "tap" | "scan") => void;
  required?: boolean;
  multiple?: false;
  /** One candidate: choose it and show it as one line, no question. */
  hideWhenSingle?: boolean;
  /** Also send how it was chosen ("tap" or "scan") under this name. */
  viaName?: string;
};

type MultiProps = Base & {
  mode?: "select";
  name?: string;
  submit?: "value" | "code";
  multiple: true;
  defaultValues?: string[];
  onChangeMany?: (candidates: PickCandidate[]) => void;
  required?: boolean;
};

type EmitProps = Base & {
  mode: "emit";
  /** Every tap or scan. `value` is the candidate's value, or the normalised label payload. */
  onEmit: (value: string, candidate: PickCandidate | null, via: "tap" | "scan") => void;
  pending?: boolean;
  /** Values already done (shown ticked in the list). */
  done?: string[];
};

export type ScanOrPickProps = SelectProps | MultiProps | EmitProps;

const NO_KINDS: PickKind[] = [];

// ---- Hardware scanner bursts with nothing focused: one window listener, first waiting field wins ----
type Listener = { el: HTMLElement; waiting: () => boolean; take: (s: string) => void };
const listeners = new Set<Listener>();
let buf = { chars: "", times: [] as number[] };
function onWindowKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return void (buf = { chars: "", times: [] });
  const t = e.target as HTMLElement | null;
  const editable = !!t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
  if (editable) return void (buf = { chars: "", times: [] });
  const now = performance.now();
  if (e.key.length === 1) {
    if (buf.times.length && now - buf.times[buf.times.length - 1] > 100) buf = { chars: "", times: [] };
    buf.chars += e.key;
    buf.times.push(now);
    // A burst must not "type" into a focused button (space) or scroll the page.
    if (buf.chars.length > 1) e.preventDefault();
    return;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    const b = buf;
    buf = { chars: "", times: [] };
    if (!isScannerBurst(b)) return;
    const target = [...listeners].filter((l) => l.el.isConnected && l.waiting()).sort((a, b2) => (a.el.compareDocumentPosition(b2.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    target.take(b.chars);
    return;
  }
  if (e.key !== "Shift") buf = { chars: "", times: [] };
}
function register(l: Listener) {
  if (listeners.size === 0 && typeof window !== "undefined") window.addEventListener("keydown", onWindowKey, true);
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("keydown", onWindowKey, true);
  };
}

function buzz() {
  try {
    navigator.vibrate?.(40);
  } catch {
    /* not supported */
  }
}

function CandidateButton({ c, pressed, disabled, onTap, done }: { c: PickCandidate; pressed?: boolean; disabled?: boolean; onTap?: () => void; done?: boolean }) {
  const off = disabled || !!c.disabledReason;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {c.title}
          {c.badge && <Chip tone={c.badgeTone ?? "neu"}>{c.badge}</Chip>}
        </span>
        {c.detail && <span className="text-[13px] text-fg-2">{c.detail}</span>}
        {c.disabledReason && <span className="text-[13px] text-[var(--warn-fg)]">{c.disabledReason}</span>}
      </span>
      {(pressed || done) && <Check size={20} className="shrink-0 text-primary-text" aria-hidden />}
    </>
  );
  const cls = cx(
    "flex min-h-[56px] w-full items-center gap-3 rounded-[14px] border px-3 py-2 text-left",
    pressed || done ? "border-primary bg-primary-soft" : "border-line bg-surface",
    !off && onTap ? "hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2" : "opacity-80",
  );
  if (!onTap) return <div className={cls} data-testid="pick-option">{body}</div>;
  return (
    <button type="button" className={cls} onClick={onTap} disabled={off} aria-pressed={pressed} data-testid="pick-option">
      {body}
    </button>
  );
}

export function ScanOrPick(props: ScanOrPickProps) {
  const { kind, label, candidates = [], candidatesLabel, hint, error, search = true, allowTap = true, onlyCandidates = false, maxShown = 6, listen = true, className, alsoAccept = NO_KINDS } = props;
  const autoId = useId();
  const id = props.id ?? `sop-${autoId.replace(/:/g, "")}`;
  const words = PICK_WORDS[kind];
  const emit = props.mode === "emit";
  const multiple = !emit && "multiple" in props && props.multiple === true;
  const submit = !emit && "submit" in props && props.submit ? props.submit : "value";
  const name = !emit && "name" in props ? props.name : undefined;
  const required = !emit && "required" in props ? !!props.required : false;

  const initial = (): PickCandidate[] => {
    if (emit) return [];
    if (multiple) return candidates.filter((c) => ((props as MultiProps).defaultValues ?? []).includes(submitValue(c, submit)));
    const p = props as SelectProps;
    const v = p.value ?? p.defaultValue;
    const hit = v ? candidates.find((c) => submitValue(c, submit) === v || c.value === v) : undefined;
    if (hit) return [hit];
    if (p.hideWhenSingle && candidates.length === 1 && !candidates[0].disabledReason) return [candidates[0]];
    return [];
  };
  const [chosen, setChosen] = useState<PickCandidate[]>(initial);
  /** How the single value was chosen; forms can send it (`viaName`) so a tap is never recorded as a scan. */
  const [via, setVia] = useState<"tap" | "scan" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Plain status (not an error): "3 found. Tap the right one." */
  const [info, setInfo] = useState<string | null>(null);
  const [found, setFound] = useState<PickCandidate[]>([]);
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, start] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);
  const keys = useRef<number[]>([]);

  const candKey = candidates.map((c) => c.value).join("|");
  const prevKey = useRef(candKey);
  // Controlled single value: clear or switch when the parent says so.
  const controlled = !emit && !multiple ? (props as SelectProps).value : undefined;
  useEffect(() => {
    if (emit || multiple || controlled === undefined) return;
    const cur = chosen[0] ? submitValue(chosen[0], submit) : null;
    if ((controlled || null) === cur || (controlled && chosen[0]?.value === controlled)) return;
    const hit = controlled ? candidates.find((c) => submitValue(c, submit) === controlled || c.value === controlled) : undefined;
    setChosen(hit ? [hit] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled]);

  const notify = useCallback(
    (next: PickCandidate[], via?: "tap" | "scan") => {
      if (emit) return;
      if (multiple) (props as MultiProps).onChangeMany?.(next);
      else (props as SelectProps).onChange?.(next[0] ? submitValue(next[0], submit) : null, next[0] ?? null, via);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emit, multiple, submit, (props as SelectProps).onChange, (props as MultiProps).onChangeMany],
  );

  // New candidates (e.g. the shelves of another lot): drop a choice that is no longer offered; one → chosen.
  useEffect(() => {
    if (emit || multiple) return;
    const p = props as SelectProps;
    const changed = prevKey.current !== candKey;
    prevKey.current = candKey;
    let next = chosen;
    if (changed && chosen[0] && !candidates.some((c) => c.value === chosen[0].value) && candidates.length > 0) next = [];
    if (p.hideWhenSingle && candidates.length === 1 && !candidates[0].disabledReason && !next.length) next = [candidates[0]];
    if (next !== chosen) setChosen(next);
    if (next !== chosen || (!changed && next.length && p.hideWhenSingle)) notify(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candKey]);

  const choose = useCallback(
    (c: PickCandidate, via: "tap" | "scan") => {
      setMessage(null);
      setFound([]);
      setInfo(null);
      setText("");
      setCamera(false);
      if (via === "scan") buzz();
      if (emit) return (props as EmitProps).onEmit(c.value, c, via);
      const next = multiple ? (chosen.some((p) => p.value === c.value) ? chosen : [...chosen, c]) : [c];
      setChosen(next);
      setVia(via);
      notify(next, via);
    },
    [emit, multiple, notify, props, chosen],
  );

  const unchoose = (c: PickCandidate) => {
    const next = chosen.filter((p) => p.value !== c.value);
    setChosen(next);
    notify(next);
  };

  const runSearch = useCallback(
    (t: string) => {
      if (!search) return setMessage(notFoundMessage(kind, candidates.length > 0));
      if (onlyCandidates) {
        // Only the listed ones are allowed: filter them by the words, here on the phone.
        const hits = filterCandidates(candidates, t);
        if (hits.length === 0) return setMessage(`Nothing in the list matches "${t}". Tap one of the ${words.many} above or scan the ${words.label}.`);
        if (hits.length === 1) return choose(hits[0], "tap");
        setFound(hits);
        setMessage(null);
        return setInfo(`${hits.length} found. Tap the right one.`);
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) return setMessage("No internet. Tap one in the list, or scan when the phone is back online.");
      start(async () => {
        const r = await searchPickAction(kind, t);
        if (!r.ok) return setMessage(r.message);
        if (r.candidates.length === 0) return setMessage(`Nothing matches "${t}". Try another word, or scan the ${words.label}.`);
        if (r.candidates.length === 1 && !r.candidates[0].disabledReason) return choose(r.candidates[0], "tap");
        setFound(r.candidates);
        setMessage(null);
        setInfo(`${r.candidates.length} found. Tap the right one.`);
      });
    },
    [search, kind, candidates, onlyCandidates, words.label, words.many, choose],
  );

  /** Scanned (camera / hardware) or typed-and-entered text. */
  const handle = useCallback(
    (raw: string, fromScanner: boolean) => {
      const c = classifyPickInput(kind, raw, candidates, fromScanner, alsoAccept);
      if (c.kind === "empty") return setMessage(missingMessage(kind, candidates.length > 0));
      if (c.kind === "refused") return setMessage(c.message);
      if (c.kind === "candidate") return choose(c.candidate, "scan");
      if (c.kind === "words") return runSearch(c.text);
      // A label that is not in the list: emit mode hands scanned labels to the caller (it resolves and
      // answers); a typed number is searched by words first.
      if (emit && (fromScanner || !search)) {
        buzz();
        setMessage(null);
        return (props as EmitProps).onEmit(c.payload, null, "scan");
      }
      if (emit) return runSearch(raw);
      if (onlyCandidates) return !fromScanner && search ? runSearch(raw) : setMessage(notFoundMessage(kind, candidates.length > 0));
      if (typeof navigator !== "undefined" && navigator.onLine === false) return setMessage("No internet. Tap one in the list, or scan when the phone is back online.");
      start(async () => {
        const r = await resolvePickAction(kind, c.payload);
        if (r.ok) return choose(r.candidate, "scan");
        // A typed number that is not exact (last digits): search by words instead.
        if (!fromScanner && search) return runSearch(raw);
        setMessage(r.ok === false && /another|label\b|That is/.test(r.message) ? r.message : notFoundMessage(kind, candidates.length > 0));
      });
    },
    [kind, candidates, choose, runSearch, emit, onlyCandidates, search, props, alsoAccept],
  );

  const waiting = emit ? !(props as EmitProps).pending : multiple ? true : chosen.length === 0;
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => {
    if (!listen || !wrap.current) return;
    return register({ el: wrap.current, waiting: () => waitingRef.current, take: (s) => handleRef.current(s, true) });
  }, [listen]);

  // A required field blocks its form until something is chosen (never a fake value).
  useEffect(() => {
    if (!required || !wrap.current) return;
    const form = wrap.current.closest("form");
    if (!form) return;
    const onSubmit = (e: Event) => {
      if (wrap.current?.querySelector("input[data-pick-value]")) return;
      e.preventDefault();
      e.stopPropagation();
      setMessage(missingMessage(kind, candidates.length > 0));
      wrap.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [required, kind, candidates.length]);

  const single = !emit && !multiple ? chosen[0] : undefined;
  const hiddenSingle = !emit && !multiple && (props as SelectProps).hideWhenSingle && candidates.length === 1 && single?.value === candidates[0].value;
  const doneSet = useMemo(() => new Set(emit ? ((props as EmitProps).done ?? []) : []), [emit, props]);
  const list = candidates;
  const shown = showAll ? list : list.slice(0, maxShown);
  const err = message ?? (chosen.length ? null : (error ?? null));

  const viaName = !emit && "viaName" in props ? props.viaName : undefined;
  const hidden = name ? (
    <>
      {chosen.map((c) => (
        <input key={c.value} type="hidden" name={name} value={submitValue(c, submit)} data-pick-value="" />
      ))}
      {viaName && chosen.length > 0 && <input type="hidden" name={viaName} value={via ?? "tap"} />}
    </>
  ) : null;

  if (hiddenSingle && single) {
    return (
      <div ref={wrap} className={cx("text-[14px] text-fg-2", className)} data-testid={`scan-or-pick-${name ?? id}`}>
        {hidden}
        <p>
          {label.replace(/\?$/, "")}: <strong className="text-fg">{single.title}</strong>
          {single.detail ? <span className="text-muted"> · {single.detail}</span> : null} <span className="text-muted">(the only one)</span>
        </p>
      </div>
    );
  }

  return (
    <div ref={wrap} role="group" aria-labelledby={`${id}-label`} className={cx("flex min-w-0 flex-col gap-2", className)} data-testid={`scan-or-pick-${name ?? id}`}>
      {hidden}
      <p id={`${id}-label`} className="text-[15px] font-semibold">
        {label}
      </p>
      {hint && <p className="-mt-1 text-[13px] text-muted">{hint}</p>}

      {single ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-primary bg-primary-soft px-3 py-2" data-testid="pick-chosen">
          <span className="flex min-w-0 items-start gap-2">
            <Check size={20} className="mt-0.5 shrink-0 text-primary-text" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{single.title}</span>
              {single.detail && <span className="block text-[13px] text-fg-2">{single.detail}</span>}
            </span>
          </span>
          <Button type="button" variant="ghost" onClick={() => unchoose(single)} data-testid="pick-change">
            Change
          </Button>
        </div>
      ) : (
        <>
          {multiple && chosen.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label={`Chosen ${words.many}`} data-testid="pick-chosen">
              {chosen.map((c) => (
                <li key={c.value} className="flex min-h-[48px] items-center justify-between gap-2 rounded-[12px] border border-primary bg-primary-soft px-3">
                  <span className="min-w-0 text-[14px]">
                    <span className="font-semibold">{c.title}</span> {c.detail && <span className="text-fg-2">· {c.detail}</span>}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => unchoose(c)} aria-label={`Take off ${c.title}`}>
                    <X size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {list.length > 0 && (
            <div>
              {candidatesLabel && <p className="mb-1.5 text-[13px] font-medium text-fg-2">{candidatesLabel}</p>}
              <ul className="flex flex-col gap-2" aria-label={candidatesLabel ?? label}>
                {shown.map((c) => {
                  const pressed = multiple && chosen.some((x) => x.value === c.value);
                  return (
                    <li key={c.value}>
                      <CandidateButton
                        c={c}
                        pressed={pressed}
                        done={doneSet.has(c.value)}
                        disabled={emit && (props as EmitProps).pending}
                        onTap={allowTap ? () => (pressed ? unchoose(c) : choose(c, "tap")) : undefined}
                      />
                    </li>
                  );
                })}
              </ul>
              {list.length > shown.length && (
                <Button type="button" variant="ghost" onClick={() => setShowAll(true)} className="mt-1">
                  Show all {list.length}
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant={list.length && allowTap ? "secondary" : "cta"} size="lg" onClick={() => setCamera((v) => !v)} aria-expanded={camera} data-testid="pick-scan" className="sm:w-auto">
              <Camera size={18} /> {camera ? "Close the camera" : `Scan the ${words.label}`}
            </Button>
            {search && (
              <div role="search" className="flex min-w-0 flex-1 gap-2">
                <label htmlFor={`${id}-words`} className="sr-only">
                  Find the {words.one} by name
                </label>
                <input
                  id={`${id}-words`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  placeholder="Or find by name"
                  data-testid="pick-search"
                  onKeyDown={(e) => {
                    const now = performance.now();
                    keys.current = [...keys.current.filter((t) => now - t < 600), now];
                    if (e.key === "Enter" || e.key === "Tab") {
                      const gaps = keys.current.slice(1, -1).map((t, i) => t - keys.current[i]);
                      const fromScanner = keys.current.length >= 5 && gaps.every((g) => g < 50);
                      if (e.key === "Tab" && !fromScanner) return;
                      e.preventDefault();
                      keys.current = [];
                      const t = e.currentTarget.value;
                      if (t.trim()) handle(t, fromScanner);
                    }
                  }}
                  className={`${inputClass} min-h-[52px] min-w-0 flex-1 text-[16px]`}
                />
                <Button type="button" variant="secondary" size="lg" disabled={busy || !text.trim()} onClick={() => handle(text, false)} aria-label={`Find the ${words.one} by name`}>
                  <Search size={18} />
                </Button>
              </div>
            )}
          </div>
          {camera && (
            <Scanner cameraOnly onClose={() => setCamera(false)} onScan={(v) => handle(v, true)} autoFocus={false} label={`Scan the ${words.label}`} />
          )}
          <p className="text-[12px] text-muted">A handheld scanner works any time: just scan the {words.label}.</p>
          {busy && <p className="text-[13px] text-muted" role="status">Looking…</p>}
          {!busy && info && found.length > 0 && <p className="text-[13px] text-fg-2" role="status">{info}</p>}
          {found.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label={`Matching ${words.many}`} data-testid="pick-found">
              {found.map((c) => (
                <li key={c.value}>
                  <CandidateButton c={c} onTap={() => choose(c, "tap")} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && (
        <p role="alert" className="rounded-[10px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[14px] text-[var(--bad-fg)]" data-testid="pick-error">
          {err}
        </p>
      )}
    </div>
  );
}
