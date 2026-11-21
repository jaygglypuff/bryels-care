"use client";
import Link from "next/link";
import { startTransition, useMemo, useState, useTransition } from "react";
import { Minus, PackageOpen, Plus, RotateCcw, X } from "lucide-react";
import { Button, Card, Field, Input, Select, cx } from "@/ui/core";
import { ScanOrPick } from "@/ui/scan-or-pick";
import { Banner } from "@/ui/status";
import { useRenewableClientKey } from "@/ui/use-client-key";
import type { SourceView, TakeoutResult } from "@/modules/inventory";
import { createTakeoutAction, takeoutLookupAction, takeoutProductAction, undoTakeoutAction } from "./actions";

type Product = { productId: string; name: string; sku: string; free: string; uom: string; where: string };
type Channel = { code: string; label: string };
type Customer = { id: string; name: string; code: string };
/** "auto" = the app chooses (shop shelf, open box or loose pieces first, then the earliest expiry). */
type Line = { key: string; productId: string; productName: string; sources: SourceView[]; sourceKey: string; pieces: string; fixed: boolean };

/** Reasons in the order of the phone (words from the inventory module's PURPOSE_WORDS; kept here so no server code ships). */
const PURPOSES: { key: string; label: string; hint: string }[] = [
  { key: "sold_online", label: "Sold online", hint: "An online shop order" },
  { key: "customer_sample", label: "Sample for a customer", hint: "Free pieces for a customer" },
  { key: "giveaway", label: "Giveaway or marketing", hint: "Gift, prize, social media" },
  { key: "display", label: "Display or shop shelf", hint: "On show in the shop or at an event" },
  { key: "staff_use", label: "Staff use", hint: "Used or given to staff" },
  { key: "other", label: "Other", hint: "Say what happened" },
];

const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : 0);
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

function sourceWords(s: SourceView) {
  const where = s.boxNumber ? `Box ${s.boxNumber}${s.boxStatus === "open" ? " (open)" : " (closed)"} on ${s.locationCode}` : `Loose on ${s.locationCode}`;
  return `${where} · ${s.free} free${s.shopShelf ? " · online shop shelf" : ""}${s.expiresOn ? ` · use by ${s.expiresOn}` : ""} · lot ${s.lotNumber}`;
}

function Stepper({ id, value, onChange, max }: { id: string; value: string; onChange: (v: string) => void; max?: number }) {
  const v = n(value);
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" className="min-h-[44px] min-w-[44px] px-0" aria-label="One less" disabled={v <= 1} onClick={() => onChange(String(Math.max(1, v - 1)))}>
        <Minus size={18} aria-hidden />
      </Button>
      <Input id={id} inputMode="numeric" pattern="[0-9]*" className="w-20 text-center text-[18px] font-semibold tabular-nums" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} aria-label="How many pieces" />
      <Button type="button" variant="secondary" className="min-h-[44px] min-w-[44px] px-0" aria-label="One more" disabled={max !== undefined && v >= max} onClick={() => onChange(String(v + 1))}>
        <Plus size={18} aria-hidden />
      </Button>
    </div>
  );
}

export function TakeOutFlow({
  products,
  channels,
  customers,
  shelves,
  limits,
  initial,
  canSeeCustomers,
  canSeeList,
}: {
  products: Product[];
  channels: Channel[];
  customers: Customer[];
  shelves: { id: string; code: string; name: string }[];
  limits: { perLine: number; perPersonDay: number };
  initial: SourceView[] | null;
  canSeeCustomers: boolean;
  canSeeList: boolean;
}) {
  const fromSources = (sources: SourceView[], fixed: boolean): Line => ({ key: `${sources[0].productId}:${Date.now()}:${Math.random()}`, productId: sources[0].productId, productName: sources[0].productName, sources, sourceKey: fixed ? sources[0].key : "auto", pieces: "1", fixed });
  const [lines, setLines] = useState<Line[]>(() => (initial?.length ? [fromSources(initial, true)] : []));
  const [purpose, setPurpose] = useState("");
  const [channel, setChannel] = useState(channels.length === 1 ? channels[0].code : "");
  const [orderRef, setOrderRef] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TakeoutResult | null>(null);
  const [key, renewKey] = useRenewableClientKey();
  const [busy, start] = useTransition();

  const total = lines.reduce((s, l) => s + n(l.pieces), 0);
  const overLine = lines.some((l) => n(l.pieces) > limits.perLine);
  const ready = lines.length > 0 && lines.every((l) => n(l.pieces) > 0) && !!purpose && (purpose !== "sold_online" || !!channel) && (purpose !== "other" || note.trim().length >= 3) && !!key;

  const addSources = (sources: SourceView[], fixed: boolean) => {
    setError(null);
    setLines((cur) => {
      // The same box scanned again, or the same product tapped again: one more piece instead of a new line.
      const same = cur.find((l) => (fixed ? l.fixed && l.sourceKey === sources[0].key : !l.fixed && l.productId === sources[0].productId));
      if (same) return cur.map((l) => (l === same ? { ...l, pieces: String(n(l.pieces) + 1) } : l));
      return [...cur, fromSources(sources, fixed)];
    });
  };
  const lookup = (raw: string) =>
    start(async () => {
      const r = await takeoutLookupAction(raw);
      startTransition(() => (r.ok ? addSources(r.sources, r.sources.length === 1) : setError(r.message)));
    });
  const pickProduct = (productId: string) =>
    start(async () => {
      const r = await takeoutProductAction(productId);
      startTransition(() => (r.ok ? addSources(r.sources, false) : setError(r.message)));
    });
  const setLine = (k: string, patch: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const reset = () => {
    setLines([]);
    setPurpose("");
    setOrderRef("");
    setCustomerId("");
    setRecipient("");
    setNote("");
    setError(null);
    setFieldErrors({});
    setResult(null);
    renewKey();
  };

  const save = () =>
    start(async () => {
      setError(null);
      const r = await createTakeoutAction({
        idempotencyKey: key,
        purpose,
        channel: purpose === "sold_online" ? channel : null,
        platformOrderRef: purpose === "sold_online" ? orderRef || null : null,
        customerId: purpose === "customer_sample" ? customerId || null : null,
        recipientName: purpose === "customer_sample" && !customerId ? recipient || null : null,
        note: note || null,
        lines: lines.map((l) => {
          const s = l.sources.find((x) => x.key === l.sourceKey);
          if (!s) return { productId: l.productId, pieces: l.pieces };
          return s.containerId ? { containerId: s.containerId, lotId: s.lotId, pieces: l.pieces } : { lotId: s.lotId, locationId: s.locationId, pieces: l.pieces };
        }),
      });
      startTransition(() => {
        if (r.ok) setResult(r.result);
        else {
          setError(r.message);
          setFieldErrors(r.fieldErrors ?? {});
        }
      });
    });

  if (result) return <Saved result={result} onNext={reset} canSeeList={canSeeList} />;

  const chosen = new Set(lines.filter((l) => !l.fixed).map((l) => l.productId));
  return (
    <div className="space-y-4" data-testid="takeout-flow">
      {error && (
        <Banner tone="bad" title="Nothing was saved">
          {error}
        </Banner>
      )}
      <Card>
        <h2 className="text-[16px] font-semibold">1 · What goes out?</h2>
        <div className="mt-3">
          <ScanOrPick mode="emit" kind="container" alsoAccept={["lot"]} id="takeout-scan" label="Scan the box or lot label" hint="Or type the number on the label. Or tap a product below." candidates={[]} showCandidates={false} pending={busy} onEmit={(v) => lookup(v)} />
        </div>
        {products.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[13px] font-medium text-fg-2">Or tap a product{shelves.length ? ` (taken from ${shelves.map((s) => s.code).join(", ")} first)` : ""}</p>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Products">
              {products.map((p) => (
                <li key={p.productId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pickProduct(p.productId)}
                    className={cx("flex min-h-[56px] w-full flex-col items-start rounded-[8px] border px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60", chosen.has(p.productId) ? "border-primary bg-[var(--nav-active-bg)]" : "border-line")}
                    data-testid="takeout-product"
                  >
                    <span className="text-[15px] font-semibold">{p.name}</span>
                    <span className="text-[13px] text-fg-2">{p.free} free · first from {p.where}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {lines.length > 0 && (
        <Card>
          <h2 className="text-[16px] font-semibold">2 · How many?</h2>
          <ul className="mt-3 flex flex-col divide-y divide-line" aria-label="Pieces to take out">
            {lines.map((l, i) => {
              const src = l.sources.find((s) => s.key === l.sourceKey);
              const free = src ? n(src.free) : l.sources.reduce((s, x) => s + n(x.free), 0);
              return (
                <li key={l.key} className="flex flex-col gap-2 py-3" data-testid="takeout-line">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[15px] font-semibold">{l.productName}</p>
                    <Button type="button" variant="ghost" className="min-h-[36px] px-2" aria-label={`Remove ${l.productName}`} onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>
                      <X size={16} aria-hidden />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Pieces" htmlFor={`pcs-${i}`} error={fieldErrors[`lines.${i}.pieces`]}>
                      <Stepper id={`pcs-${i}`} value={l.pieces} onChange={(v) => setLine(l.key, { pieces: v })} max={free} />
                    </Field>
                    <Field label="Take from" htmlFor={`src-${i}`}>
                      {l.fixed && l.sources.length === 1 ? (
                        <p className="min-h-[44px] content-center text-[14px]">{sourceWords(l.sources[0])}</p>
                      ) : (
                        <Select id={`src-${i}`} value={l.sourceKey} onChange={(e) => setLine(l.key, { sourceKey: e.target.value })} className="max-w-full sm:max-w-[420px]">
                          {!l.fixed && <option value="auto">Suggested: {sourceWords(l.sources[0])}</option>}
                          {l.sources.map((s) => (
                            <option key={s.key} value={s.key}>
                              {sourceWords(s)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                  {n(l.pieces) > free && <p className="text-[13px] font-medium text-[var(--warn-fg)]">Only {free} free there. Lower the number{l.sourceKey !== "auto" && !l.fixed ? " or choose Suggested" : ""}.</p>}
                  {src?.boxStatus === "sealed" && <p className="flex items-center gap-1.5 text-[13px] text-fg-2"><PackageOpen size={15} aria-hidden /> This box is closed. Taking pieces opens it; the app then counts it as an open box.</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {lines.length > 0 && (
        <Card>
          <h2 className="text-[16px] font-semibold">3 · Why?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Why the pieces go out">
            {PURPOSES.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={purpose === p.key}
                onClick={() => setPurpose(p.key)}
                className={cx("flex min-h-[52px] flex-col items-start rounded-[8px] border px-3 py-2 text-left", purpose === p.key ? "border-primary bg-[var(--nav-active-bg)] shadow-[inset_3px_0_0_var(--primary)]" : "border-line hover:bg-surface-2")}
                data-testid={`purpose-${p.key}`}
              >
                <span className="text-[15px] font-semibold">{p.label}</span>
                <span className="text-[12px] text-fg-2">{p.hint}</span>
              </button>
            ))}
          </div>
          {fieldErrors.purpose && <p className="mt-2 text-[13px] text-[var(--bad-fg)]">{fieldErrors.purpose}</p>}
          {purpose === "sold_online" && (
            <div className="mt-4 space-y-3">
              <fieldset>
                <legend className="mb-2 text-[14px] font-medium">Which online shop?</legend>
                <div className="flex flex-wrap gap-2">
                  {channels.map((c) => (
                    <button key={c.code} type="button" aria-pressed={channel === c.code} onClick={() => setChannel(c.code)} className={cx("min-h-[44px] rounded-[6px] border px-3.5 text-[14px] font-medium", channel === c.code ? "border-primary bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]" : "border-line-strong hover:bg-surface-2")}>
                      {c.label}
                    </button>
                  ))}
                </div>
                {fieldErrors.channel && <p className="mt-1 text-[13px] text-[var(--bad-fg)]">{fieldErrors.channel}</p>}
              </fieldset>
              <Field label="Shop order number (optional)" htmlFor="orderRef" hint="From the Shopee, Lazada or TikTok app. Helps to find it later.">
                <Input id="orderRef" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} maxLength={60} autoComplete="off" />
              </Field>
            </div>
          )}
          {purpose === "customer_sample" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {canSeeCustomers && customers.length > 0 && (
                <Field label="For which customer? (optional)" htmlFor="customerId">
                  <Select id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Not a customer yet / type a name</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {!customerId && (
                <Field label="Name (optional)" htmlFor="recipient" hint="Someone who may buy, a shop, an event.">
                  <Input id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={120} />
                </Field>
              )}
            </div>
          )}
          <div className="mt-4">
            <Field label={purpose === "other" ? "What happened?" : "Note (optional)"} htmlFor="note" error={fieldErrors.note}>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required={purpose === "other"} />
            </Field>
          </div>
        </Card>
      )}

      {lines.length > 0 && (
        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:rounded-[8px] sm:border sm:p-5">
          {overLine && <p className="text-[13px] font-medium text-[var(--warn-fg)]">More than {limits.perLine} of one product: this waits for the manager&apos;s OK before stock changes.</p>}
          <Button type="button" variant="cta" size="lg" className="w-full sm:w-auto" disabled={busy || !ready} onClick={save} data-testid="takeout-save">
            {busy ? "Saving…" : `Take out ${plural(total, "piece", "pieces")}`}
          </Button>
          <p className="text-[12px] text-muted">Tapping twice or no signal and trying again never takes them out twice. You can undo your own take-out today.</p>
        </div>
      )}
    </div>
  );
}

function Saved({ result, onNext, canSeeList }: { result: TakeoutResult; onNext: () => void; canSeeList: boolean }) {
  const [reason, setReason] = useState("Entered by mistake");
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const what = useMemo(() => result.lines.map((l) => `${l.pieces} ${l.productName}`).join(", "), [result.lines]);
  const waiting = result.status === "awaiting_approval";
  return (
    <div role="status" aria-live="polite" className="space-y-3" data-testid="takeout-saved">
      <Banner tone={waiting ? "warn" : "ok"} title={waiting ? `Waiting for the manager's OK · ${result.takeoutNumber}` : `Taken out · ${result.takeoutNumber}${result.replayed ? " (already saved)" : ""}`}>
        {what}. {result.sentence}.{waiting ? ` ${result.approvalReason} Nothing leaves the stock until the OK.` : ""}
      </Banner>
      {!waiting && (
        <ul className="rounded-[8px] border border-line bg-surface text-[14px]">
          {result.lines.map((l) => (
            <li key={l.lineNo} className="border-b border-line px-3 py-2 last:border-0">
              {l.pieces} {l.productName} from {l.boxNumber ? `box ${l.boxNumber}` : "loose pieces"} on {l.placeCode} <span className="font-mono text-[12px] text-muted">lot {l.lotNumber}</span>
              {l.openedBox && <span className="ml-1 text-fg-2">· the box is now open</span>}
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <Banner tone={msg.ok ? "ok" : "warn"} title={msg.ok ? "Undone" : "Undo not possible"}>
          {msg.text}
        </Banner>
      )}
      {asking && !msg?.ok && (
        <div className="flex flex-wrap items-end gap-2 rounded-[8px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3">
          <Field label="Why undo?" htmlFor="undo-reason">
            <Input id="undo-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </Field>
          <Button
            type="button"
            variant="danger"
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await undoTakeoutAction(result.id, reason);
                startTransition(() => setMsg({ ok: r.ok, text: r.message }));
              })
            }
          >
            {pending ? "Undoing…" : "Yes, undo it"}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="cta" onClick={onNext} data-testid="takeout-next">
          Next take-out
        </Button>
        {!waiting && !asking && !msg?.ok && (
          <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
            <RotateCcw size={16} aria-hidden /> Undo
          </Button>
        )}
        {canSeeList && (
          <Link href={`/inventory/take-outs/${result.id}`} className="inline-flex min-h-[44px] items-center px-2 text-[14px] font-medium text-primary-text hover:underline">
            Open {result.takeoutNumber}
          </Link>
        )}
      </div>
    </div>
  );
}
