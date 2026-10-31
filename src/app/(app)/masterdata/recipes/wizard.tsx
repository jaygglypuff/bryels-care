"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Plus, Search, Trash2, X } from "lucide-react";
import {
  AREAS_WORDS,
  type AmountUnit,
  type BatchBy,
  type RecipeDraft,
  type RecipeLineDraft,
  type RecipePackagingDraft,
  type RecipeReadingDraft,
  type RecipeStepDraft,
  PER_PIECE_DECIMALS,
  RECIPE_BLOCKS,
  WAIT_UNITS,
  draftPieces,
  gramsTotalText,
  isDecimalText,
  isPieceGText,
  isPiecesText,
  kgToGrams,
  lineGrams,
  lineShown,
  newStep,
  packagingKeep,
  packagingQty,
  percentFromGrams,
  percentTotalText,
  pieceWord,
  piecesToBatchKg,
  recipeTotals,
  stepPreviewLine,
} from "@/modules/masterdata/recipe-blocks";
import type { RecipeWizardOptions } from "@/modules/masterdata";
import { Button, Card, Input, Select, Textarea, cx } from "@/ui/core";
import { BlockIcon } from "./block-icon";
import { RecipeSummary, batchPiecesSentence, piecesPerBatch } from "./recipe-summary";
import { createRecipeIngredientAction, createRecipePackagingAction, createRecipeProductAction, loadRecipeCopyAction, saveRecipeAction } from "./actions";

type Errors = Record<string, string>;
type Product = RecipeWizardOptions["products"][number];
type Material = RecipeWizardOptions["materials"][number];
/** The wizard's state: the draft with the pieces and packaging fields always present. */
type WDraft = RecipeDraft & Required<Pick<RecipeDraft, "batchBy" | "pieces" | "pieceG" | "packaging">>;

const TITLES = ["Which product?", "How big is one batch?", "Ingredients", "Steps", "Check and save"] as const;

/** Which wizard screen a server field error belongs to. */
function screenOf(key: string): number {
  if (key === "productId") return 1;
  if (key === "batchKg" || key === "expectedPct" || key === "pieces" || key === "pieceG") return 2;
  if (key.startsWith("lines") || key.startsWith("packaging")) return 3;
  if (key.startsWith("steps")) return 4;
  return 5;
}

const fmt = (v: string, dp = 4) => (v && !Number.isNaN(Number(v)) ? Number(v).toLocaleString("en-PH", { maximumFractionDigits: dp }) : "");

/** A small "What is this?" explainer (no script needed). */
function WhatIsThis({ children }: { children: ReactNode }) {
  return (
    <details className="text-[13px]">
      <summary className="inline-flex min-h-[32px] cursor-pointer items-center text-primary-text underline-offset-2 hover:underline">What is this?</summary>
      <div className="mt-1 rounded-[12px] bg-surface-2 p-3 text-fg-2">{children}</div>
    </details>
  );
}

function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[15px] font-semibold text-fg">
        {children}
      </label>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

function ErrorText({ text }: { text?: string }) {
  return text ? (
    <p role="alert" className="text-[13px] font-medium text-[var(--bad-fg)]">
      {text}
    </p>
  ) : null;
}

/** Big square icon buttons (≥ 44 px) for move up/down, copy, remove. */
function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-11 w-11 items-center justify-center rounded-[12px] border border-line bg-surface text-fg hover:bg-surface-2 disabled:opacity-30",
        danger && "text-[var(--bad-fg)]",
      )}
    >
      {children}
    </button>
  );
}

function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const c = [...list];
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}

export type WizardStart = {
  /** "new" = a new recipe; "edit" = an open draft; "version" = a new version of an approved recipe. */
  kind: "new" | "edit" | "version";
  ingredientsLabel: string;
  stepsLabel: string;
  /** Version numbers that will be sent (> 1 needs "what changed"). */
  formulaNo: number;
  routingNo: number;
  locks: { ingredients: boolean; steps: boolean };
  productName?: string;
  materialNames?: Record<string, string>;
};

/**
 * Guided "New recipe" / "Edit recipe" wizard (ADR-089): five screens, one question group each, Back /
 * Next, plain words. Nothing here decides a rule: "Save as draft" and "Send for approval" call the
 * recipe service, which saves through the existing formula and routing services.
 */
export function RecipeWizard({ options, initial, start }: { options: RecipeWizardOptions; initial: RecipeDraft; start: WizardStart }) {
  const router = useRouter();
  const [d, setD] = useState<WDraft>(() => ({ batchBy: "kg", pieces: "", pieceG: "", packaging: [], ...initial }) as WDraft);
  const [screen, setScreen] = useState(start.kind === "new" ? 1 : 2);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [products, setProducts] = useState<Product[]>(options.products);
  const [materials, setMaterials] = useState<Material[]>(options.materials);
  const [activate, setActivate] = useState(true);
  const [pending, startTransition] = useTransition();

  const product = products.find((p) => p.id === d.productId) ?? null;
  const matName = (id: string) => materials.find((m) => m.id === id)?.name ?? start.materialNames?.[id] ?? "Choose an item";
  /** Grams of one piece: the product's, else the one typed here (saved to the product when the recipe is saved). */
  const pieceGOf = (x: WDraft) => products.find((p) => p.id === x.productId)?.pieceG ?? (isPieceGText(x.pieceG) ? x.pieceG.trim() : null);
  const pieceG = pieceGOf(d);
  const batchG = isDecimalText(d.batchKg, 3) ? kgToGrams(d.batchKg) : "0";
  const pieces = draftPieces(d, pieceG);
  const totals = useMemo(() => recipeTotals(batchG, d.lines), [batchG, d.lines]);
  /** By pieces, the kilograms are always worked out from the pieces (the same function the server uses). */
  const sync = (x: WDraft): WDraft => (x.batchBy === "pcs" ? { ...x, batchKg: piecesToBatchKg(x.pieces, pieceGOf(x), x.expectedPct) ?? "" } : x);
  const set = (patch: Partial<WDraft>) => setD((x) => sync({ ...x, ...patch }));
  const setLine = (i: number, patch: Partial<RecipeLineDraft>) => setD((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const setStep = (i: number, patch: Partial<RecipeStepDraft>) => setD((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  /** Light checks before moving on (the server checks everything again when saving). */
  function check(n: number): Errors {
    const e: Errors = {};
    if (n === 1 && !d.productId) e.productId = "Choose the product, or make a new one.";
    if (n === 2) {
      if (!isDecimalText(d.expectedPct, 2) || Number(d.expectedPct) <= 0 || Number(d.expectedPct) > 100) e.expectedPct = "Type a number above 0 and at most 100, like 95.";
      if (d.batchBy === "pcs") {
        if (!isPiecesText(d.pieces)) e.pieces = "Type how many pieces one batch makes, as a whole number, like 70.";
        if (!pieceG) e.pieceG = options.can.editProduct ? "Type how heavy one piece is, in grams, like 135." : "This product has no weight per piece yet. Choose “By weight (kg)”, or ask someone who can edit products to add its size.";
      } else if (!isDecimalText(d.batchKg, 3) || Number(d.batchKg) <= 0) e.batchKg = "Type how many kilograms one batch makes, like 17.6.";
    }
    if (n === 3 && !start.locks.ingredients) {
      d.lines.forEach((l, i) => {
        if (!l.materialId) e[`lines.${i}.materialId`] = "Choose the ingredient.";
        if (!isDecimalText(l.amount, l.src === "pct" ? 4 : 6) || Number(l.amount) <= 0) e[`lines.${i}.quantityG`] = "Type the amount.";
        if (!isDecimalText(l.diff, 6)) e[`lines.${i}.tolerancePct`] = "Type the allowed difference.";
      });
      if (d.view === "pct" && d.lines.length && !totals.exact) e.lines = `${percentTotalText(totals)}. The amounts must add up to 100%.`;
      d.packaging.forEach((p, i) => {
        if (!p.materialId) e[`packaging.${i}.materialId`] = "Choose the packaging item.";
        if (!p.from && (!isDecimalText(p.perPiece, PER_PIECE_DECIMALS) || Number(p.perPiece) <= 0)) e[`packaging.${i}.perPiece`] = "Type how many go on one piece, like 1.";
      });
      if (d.packaging.length && pieces === "0") e.packaging = pieceG ? "One batch makes less than one piece. Check the batch size on screen 2." : "Packaging is counted per piece: on screen 2 choose “By pieces”, or type how heavy one piece is.";
    }
    if (n === 4 && !start.locks.steps) {
      d.steps.forEach((s, i) => {
        if (!s.name.trim()) e[`steps.${i}.name`] = "Give the step a name.";
        if ((s.stepKind === "curing" || s.stepKind === "hold") && !s.waitAmount.trim()) e[`steps.${i}.minDurationMinutes`] = "Type how long to wait.";
      });
    }
    return e;
  }

  function go(n: number) {
    if (n > screen) {
      for (let k = screen; k < n; k++) {
        const e = check(k);
        if (Object.keys(e).length) {
          setErrors(e);
          setScreen(k);
          setBanner({ ok: false, text: Object.values(e)[0] });
          return;
        }
      }
    }
    setErrors({});
    setBanner(null);
    setScreen(n);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function save(submit: boolean) {
    for (const k of [1, 2, 3, 4]) {
      const e = check(k);
      if (Object.keys(e).length) {
        setErrors(e);
        setBanner({ ok: false, text: `${Object.values(e)[0]} (screen ${k}: ${TITLES[k - 1]})` });
        return;
      }
    }
    setBanner(null);
    startTransition(async () => {
      const res = await saveRecipeAction({ ...d, submit, activateProduct: submit && activate && product?.status === "draft" && options.can.activateProduct });
      if (!res.ok || !res.data) {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        const where = Object.keys(fe).map(screenOf);
        setBanner({ ok: false, text: res.message ?? "Not saved." });
        if (where.length && Math.min(...where) < 5) setScreen(Math.min(...where));
        return;
      }
      const r = res.data;
      setBanner({ ok: true, text: res.message ?? "Saved." });
      router.push(`/masterdata/recipes/${r.formulaId}?saved=${submit ? "sent" : "draft"}`);
    });
  }

  const versionLabel =
    start.kind === "new" ? "Version 1 (new draft)" : start.kind === "version" ? `Version ${start.formulaNo} (new draft)` : `Version ${start.formulaNo} (draft)`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* progress */}
      <nav aria-label="Recipe steps" className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-muted">
          {start.kind === "new" ? "New recipe" : "Edit recipe"} · {versionLabel}
        </p>
        <ol className="flex gap-1.5">
          {TITLES.map((t, i) => {
            const n = i + 1;
            const here = n === screen;
            return (
              <li key={t} className="flex-1">
                <button
                  type="button"
                  onClick={() => go(n)}
                  aria-current={here ? "step" : undefined}
                  className={cx("flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[12px] border text-[13px] font-semibold", here ? "border-primary bg-primary text-white" : n < screen ? "border-line bg-primary-soft text-primary-text" : "border-line bg-surface text-muted")}
                >
                  {n < screen ? <Check size={16} aria-hidden /> : <span className="tabular">{n}</span>}
                  <span className="hidden sm:inline">{t}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <h1 className="font-display text-[26px] font-semibold tracking-tight sm:text-[30px]">
          <span className="text-muted">{screen}.</span> {TITLES[screen - 1]}
        </h1>
      </nav>

      {banner && (
        <div role={banner.ok ? "status" : "alert"} className={cx("rounded-[12px] border px-3 py-2 text-[14px]", banner.ok ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]")}>
          {banner.text}
        </div>
      )}

      {screen === 1 && (
        <ProductScreen
          locked={start.kind !== "new"}
          lockedName={start.productName}
          products={products}
          families={options.families}
          canCreate={options.can.createProduct}
          value={d.productId}
          error={errors.productId}
          onPick={(id) => set({ productId: id })}
          onCreated={(p, notes) => {
            setProducts((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name)));
            set({ productId: p.id });
            setBanner({ ok: true, text: [`${p.name} is made${p.status === "active" ? " and ready to use" : ""}.`, ...notes].join(" ") });
          }}
        />
      )}

      {screen === 2 && (
        <BatchScreen
          d={d}
          set={set}
          errors={errors}
          product={product}
          pieceG={pieceG}
          canEditProduct={options.can.editProduct}
          copySources={start.kind === "new" ? options.copySources : []}
          onCopied={(c, from) => {
            setD((x) => ({ ...x, batchBy: "kg", batchKg: c.batchKg, expectedPct: c.expectedPct, lines: c.lines, steps: c.steps, packaging: c.packaging ?? [] }));
            setBanner({ ok: true, text: `Copied the ingredients and steps of ${from}. Check them on the next screens.` });
          }}
        />
      )}

      {screen === 3 && (
        <IngredientsScreen
          d={d}
          set={set}
          setLine={setLine}
          errors={errors}
          batchG={batchG}
          totals={totals}
          materials={materials}
          matName={matName}
          locked={start.locks.ingredients}
          canCreate={options.can.createMaterial}
          defaultDiff={options.defaultDiffPct}
          weighCheck={options.weighCheck}
          onMaterialCreated={(m) => setMaterials((ms) => [...ms, m].sort((a, b) => a.name.localeCompare(b.name)))}
          pieces={pieces}
          family={product?.family ?? null}
        />
      )}

      {screen === 4 && <StepsScreen d={d} set={set} setStep={setStep} errors={errors} locked={start.locks.steps} />}

      {screen === 5 && (
        <Card>
          <RecipeSummary
            productName={product?.name ?? start.productName ?? ""}
            product={product ? { unitNetMassG: product.unitNetMassG, family: product.family, pieceG } : null}
            draft={d}
            materialName={matName}
            ingredientsLabel={start.ingredientsLabel}
            stepsLabel={start.stepsLabel}
          />
          <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rw-change" hint={start.formulaNo > 1 || start.routingNo > 1 ? "Needed before you send version 2 or later." : "Optional for the first version."}>
                What did you change, and why?
              </Label>
              <Textarea id="rw-change" value={d.changeSummary} onChange={(e) => set({ changeSummary: e.target.value })} placeholder="For example: less coconut oil because the bars were too hard." />
              <ErrorText text={errors.changeSummary} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rw-from" hint="Optional. The approver decides the final day.">
                  Use from
                </Label>
                <Input id="rw-from" type="date" min={options.today} value={d.useFrom} onChange={(e) => set({ useFrom: e.target.value })} />
                <ErrorText text={errors.useFrom} />
                <WhatIsThis>The first day new batches may use this version. Batches planned before that day keep using the version before it. (In the detailed screens this is called the &quot;effective date&quot;.)</WhatIsThis>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rw-notes" hint="Optional.">
                  Notes for the people who check the recipe
                </Label>
                <Textarea id="rw-notes" value={d.formulaNotes} onChange={(e) => set({ formulaNotes: e.target.value })} />
                <ErrorText text={errors.formulaNotes} />
              </div>
            </div>
            {product?.status === "draft" && options.can.activateProduct && options.can.submit && (
              <label className="flex min-h-[44px] items-center gap-3 text-[14px]">
                <input type="checkbox" className="h-6 w-6" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
                When I send it, also make the product <b>{product.name}</b> active (needed before it can be made or sold).
              </label>
            )}
            <p className="rounded-[12px] bg-[var(--info-bg)] px-3 py-2 text-[14px] text-[var(--info-fg)]">
              A recipe can be used for production only after someone approves it. After approval it can&apos;t be changed; to change it later you make a new version.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="secondary" size="lg" disabled={pending} onClick={() => save(false)}>
                {pending ? "Saving…" : "Save as draft"}
              </Button>
              {options.can.submit ? (
                <Button type="button" variant="cta" size="lg" disabled={pending} onClick={() => save(true)}>
                  {pending ? "Sending…" : "Send for approval"}
                </Button>
              ) : (
                <p className="self-center text-[13px] text-muted">Someone with the right to send recipes for approval sends it after you save.</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Back / Next, always in reach: sticks above the app's bottom tab bar on phones and iPads (xl has none). */}
      <div className="sticky bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 rounded-[18px] border border-line bg-surface/95 px-3 py-3 shadow-[var(--shadow-card)] backdrop-blur xl:bottom-3">
        {screen === 3 && !start.locks.ingredients && d.lines.length > 0 && (
          <p className={cx("mb-2 text-center text-[14px] font-semibold", totals.exact ? "text-[var(--ok-fg)]" : "text-[var(--warn-fg)]")}>{d.view === "pct" ? percentTotalText(totals) : gramsTotalText(totals)}</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" size="lg" onClick={() => go(screen - 1)} disabled={screen === 1}>
            <ChevronLeft size={20} aria-hidden /> Back
          </Button>
          {screen < 5 ? (
            <Button type="button" variant="primary" size="lg" onClick={() => go(screen + 1)}>
              Next <ChevronRight size={20} aria-hidden />
            </Button>
          ) : (
            <span className="text-[13px] text-muted">Screen 5 of 5</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== 1. product */

function ProductScreen({
  locked,
  lockedName,
  products,
  families,
  canCreate,
  value,
  error,
  onPick,
  onCreated,
}: {
  locked: boolean;
  lockedName?: string;
  products: Product[];
  families: { code: string; label: string }[];
  canCreate: boolean;
  value: string;
  error?: string;
  onPick: (id: string) => void;
  onCreated: (p: Product, notes: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [making, setMaking] = useState(false);
  if (locked) {
    return (
      <Card>
        <p className="text-[15px]">This recipe is for</p>
        <p className="mt-1 text-[20px] font-semibold">{lockedName}</p>
        <p className="mt-2 text-[13px] text-muted">The product of a recipe can&apos;t change. Press Next.</p>
      </Card>
    );
  }
  const shown = products.filter((p) => !q.trim() || `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Card className="flex flex-col gap-4">
      <p className="text-[15px]">Pick the product this recipe makes. Every recipe belongs to one product.</p>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label="Search products" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      <ErrorText text={error} />
      <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto" role="radiogroup" aria-label="Products">
        {shown.map((p) => {
          const chosen = p.id === value;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={!!p.formulaId}
                onClick={() => onPick(p.id)}
                className={cx("flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-2 text-left", chosen ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2", p.formulaId && "opacity-70")}
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{p.name}</span>
                  <span className="block text-[12px] text-muted">
                    {p.code} · {p.family} · {fmt(p.unitNetMassG, 3)} g{p.status === "draft" ? " · draft" : ""}
                  </span>
                </span>
                {p.formulaId ? (
                  <a href={`/masterdata/recipes/${p.formulaId}`} className="shrink-0 text-[13px] font-medium text-primary-text underline" onClick={(e) => e.stopPropagation()}>
                    Has a recipe · open it
                  </a>
                ) : chosen ? (
                  <Check size={22} className="shrink-0 text-primary-text" aria-hidden />
                ) : null}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="rounded-[14px] border border-dashed border-line-strong p-4 text-center text-[14px] text-muted">No product with that name.</li>}
      </ul>
      {canCreate &&
        (making ? (
          <NewProductForm
            families={families}
            onCancel={() => setMaking(false)}
            onCreated={(p, notes) => {
              onCreated(p, notes);
              setMaking(false);
            }}
          />
        ) : (
          <Button type="button" variant="secondary" size="lg" onClick={() => setMaking(true)}>
            <Plus size={20} aria-hidden /> Make a new product
          </Button>
        ))}
    </Card>
  );
}

function NewProductForm({ families, onCancel, onCreated }: { families: { code: string; label: string }[]; onCancel: () => void; onCreated: (p: Product, notes: string[]) => void }) {
  const [f, setF] = useState({ name: "", sizeG: "", family: families[0]?.code ?? "", unitsPerBox: "", shelfLifeMonths: "" });
  const [err, setErr] = useState<Errors>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const word = f.family.toLowerCase().includes("soap") ? "bars" : "pieces";
  return (
    <fieldset className="flex flex-col gap-3 rounded-[16px] border border-line bg-surface-2/60 p-4">
      <legend className="px-1 text-[15px] font-semibold">New product</legend>
      <p className="text-[13px] text-muted">Makes the product and the item you sell, and makes both ready to use (if you are allowed to).</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="np-name">Name</Label>
        <Input id="np-name" value={f.name} placeholder="Calamansi Soap 135 g" onChange={(e) => setF({ ...f, name: e.target.value })} />
        <ErrorText text={err.name} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="np-size" hint="How much one piece or bottle weighs, without the wrapper.">
            Size (grams)
          </Label>
          <Input id="np-size" inputMode="decimal" value={f.sizeG} placeholder="135" onChange={(e) => setF({ ...f, sizeG: e.target.value })} />
          <ErrorText text={err.sizeG} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="np-family" hint={`Sold as ${word}.`}>
            What kind of product?
          </Label>
          <Select id="np-family" value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })}>
            {families.map((x) => (
              <option key={x.code} value={x.code}>
                {x.label}
              </option>
            ))}
          </Select>
          <ErrorText text={err.family} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="np-box">How many in one box?</Label>
          <Input id="np-box" inputMode="numeric" value={f.unitsPerBox} placeholder="48" onChange={(e) => setF({ ...f, unitsPerBox: e.target.value })} />
          <ErrorText text={err.unitsPerBox} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="np-life" hint="How many months it stays good after it is made.">
            Shelf life (months)
          </Label>
          <Input id="np-life" inputMode="numeric" value={f.shelfLifeMonths} placeholder="24" onChange={(e) => setF({ ...f, shelfLifeMonths: e.target.value })} />
          <ErrorText text={err.shelfLifeMonths} />
        </div>
      </div>
      {msg && <ErrorText text={msg} />}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="cta"
          size="lg"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await createRecipeProductAction(f);
              if (!r.ok || !r.data) {
                setErr(r.fieldErrors ?? {});
                setMsg(r.message ?? "Not saved.");
                return;
              }
              const { notes, ...prod } = r.data;
              onCreated({ ...prod, formulaId: null, pieceG: Number(prod.unitNetMassG) > 0 ? String(Number(prod.unitNetMassG)) : null }, notes);
            })
          }
        >
          {pending ? "Making…" : "Make this product"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

/* ================================================================== 2. batch */

type CopyData = { batchKg: string; expectedPct: string; lines: RecipeLineDraft[]; steps: RecipeStepDraft[]; packaging?: RecipePackagingDraft[] };

function BatchScreen({
  d,
  set,
  errors,
  product,
  pieceG,
  canEditProduct,
  copySources,
  onCopied,
}: {
  d: WDraft;
  set: (p: Partial<WDraft>) => void;
  errors: Errors;
  product: Product | null;
  /** Grams of one piece (the product's, else typed here); null when unknown. */
  pieceG: string | null;
  canEditProduct: boolean;
  copySources: RecipeWizardOptions["copySources"];
  onCopied: (c: CopyData, from: string) => void;
}) {
  const [src, setSrc] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byPieces = d.batchBy === "pcs";
  const pieces = byPieces ? null : piecesPerBatch(d.batchKg, d.expectedPct, pieceG, product?.family);
  const sentence = byPieces ? batchPiecesSentence(d.pieces, pieceG, d.batchKg, product?.family) : null;
  const hasContent = d.lines.length > 0 || d.steps.length > 0;
  const productHasWeight = !!product?.pieceG;
  const word = pieceWord(product?.family);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="rw-by-label" className="text-[15px] font-semibold text-fg">
            How do you count one batch?
          </span>
          <div role="radiogroup" aria-labelledby="rw-by-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ["pcs", "By pieces", `For example 70 ${word}`],
                ["kg", "By weight (kg)", "For example 17.6 kg of mix"],
              ] as [BatchBy, string, string][]
            ).map(([k, label, ex]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={d.batchBy === k}
                onClick={() => set({ batchBy: k })}
                className={cx("flex min-h-[56px] flex-col justify-center rounded-[14px] border px-4 py-2 text-left", d.batchBy === k ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2")}
              >
                <span className="text-[16px] font-semibold">{label}</span>
                <span className="text-[12px] text-muted">{ex}</span>
              </button>
            ))}
          </div>
        </div>

        {byPieces ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rw-pieces" hint="One batch is everything you mix in one go, in one pot.">
              How many {word} does one batch make?
            </Label>
            <div className="flex items-center gap-2">
              <Input id="rw-pieces" inputMode="numeric" className="w-40 text-[20px] font-semibold" value={d.pieces} placeholder="70" onChange={(e) => set({ pieces: e.target.value.replace(/[^\d]/g, "") })} />
              <span className="text-[17px] font-medium">{word}</span>
            </div>
            <ErrorText text={errors.pieces} />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rw-batch" hint="One batch is everything you mix in one go, in one pot.">
              How many kilograms does one batch make?
            </Label>
            <div className="flex items-center gap-2">
              <Input id="rw-batch" inputMode="decimal" className="w-40 text-[20px] font-semibold" value={d.batchKg} placeholder="17.6" onChange={(e) => set({ batchKg: e.target.value.replace(",", ".") })} aria-describedby="rw-batch-note" />
              <span className="text-[17px] font-medium">kg</span>
            </div>
            <ErrorText text={errors.batchKg} />
            <p id="rw-batch-note" className="text-[13px] text-muted">
              {isDecimalText(d.batchKg, 3) ? `= ${fmt(kgToGrams(d.batchKg), 3)} g` : "Example: 17.6 kg."} For liquids, weigh them too: type kilograms, not litres.
            </p>
          </div>
        )}

        {!productHasWeight &&
          (byPieces || d.packaging.length > 0) &&
          (canEditProduct ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rw-piece-g" hint="Without the wrapper. It is saved to the product when you save the recipe.">
                How heavy is one piece? (g)
              </Label>
              <div className="flex items-center gap-2">
                <Input id="rw-piece-g" inputMode="decimal" className="w-32 text-[18px]" value={d.pieceG} placeholder="135" onChange={(e) => set({ pieceG: e.target.value.replace(",", ".") })} />
                <span className="text-[17px] font-medium">g</span>
              </div>
              <ErrorText text={errors.pieceG} />
            </div>
          ) : (
            <p role="alert" className="rounded-[12px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[14px] text-[var(--warn-fg)]">
              {product?.name ?? "This product"} has no weight per piece yet, so pieces can&apos;t be turned into kilograms. Choose “By weight (kg)”, or ask someone who can edit products to add its size (grams) under Products.
            </p>
          ))}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rw-yield" hint="Out of everything you mix, how much ends up as product you can sell?">
            Expected amount made (%)
          </Label>
          <div className="flex items-center gap-2">
            <Input id="rw-yield" inputMode="decimal" className="w-32 text-[18px]" value={d.expectedPct} onChange={(e) => set({ expectedPct: e.target.value.replace(",", ".") })} />
            <span className="text-[17px] font-medium">%</span>
          </div>
          <ErrorText text={errors.expectedPct} />
          {pieces && <p className="text-[14px] font-medium text-fg">One batch makes {pieces}.</p>}
          {sentence && (
            <div className="rounded-[12px] bg-surface-2 px-3 py-2" data-testid="batch-pieces">
              <p className="text-[16px] font-semibold text-fg">{sentence.main}</p>
              <p className="text-[13px] text-muted">{sentence.how}</p>
            </div>
          )}
          <WhatIsThis>
            Some mix always stays in the pot or on the tools. If 100 kg of mix gives 95 kg of soap you can sell, type 95. If nothing is lost, type 100. The detailed screens call this the
            &quot;theoretical yield&quot;. It is used to plan how many pieces a batch makes.
          </WhatIsThis>
        </div>
      </Card>
      {copySources.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold">Start from another product&apos;s recipe? (optional)</h2>
          <p className="text-[14px] text-muted">Copies its batch size, ingredients and steps into this new recipe. The other recipe does not change. You can change everything after copying.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select aria-label="Recipe to copy" value={src} onChange={(e) => setSrc(e.target.value)}>
              <option value="">Choose a recipe…</option>
              {copySources.map((c) => (
                <option key={c.formulaId} value={c.formulaId}>
                  {c.productName} ({c.code})
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={!src || pending}
              onClick={() => {
                if (hasContent && !confirming) {
                  setConfirming(true);
                  return;
                }
                setConfirming(false);
                start(async () => {
                  const r = await loadRecipeCopyAction(src);
                  if (!r.ok || !r.data) {
                    setMsg(r.message ?? "Could not copy.");
                    return;
                  }
                  setMsg(null);
                  onCopied(r.data, r.data.from);
                });
              }}
            >
              <Copy size={18} aria-hidden /> {pending ? "Copying…" : confirming ? "Yes, replace and copy" : "Copy from this recipe"}
            </Button>
          </div>
          {confirming && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[14px] text-[var(--warn-fg)]">
              This replaces the ingredients and steps you already typed. Press the button again to copy, or
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                keep mine
              </Button>
            </div>
          )}
          <ErrorText text={msg ?? undefined} />
        </Card>
      )}
    </div>
  );
}

/* ================================================================== 3. ingredients */

function IngredientsScreen({
  d,
  set,
  setLine,
  errors,
  batchG,
  totals,
  materials,
  matName,
  locked,
  canCreate,
  defaultDiff,
  weighCheck,
  onMaterialCreated,
  pieces,
  family,
}: {
  d: WDraft;
  set: (p: Partial<WDraft>) => void;
  setLine: (i: number, p: Partial<RecipeLineDraft>) => void;
  errors: Errors;
  batchG: string;
  totals: ReturnType<typeof recipeTotals>;
  materials: Material[];
  matName: (id: string) => string;
  locked: boolean;
  canCreate: boolean;
  defaultDiff: string;
  weighCheck: "all" | "marked" | "none";
  onMaterialCreated: (m: Material) => void;
  /** Pieces one batch makes ("0" when unknown). */
  pieces: string;
  family: string | null;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const unit: AmountUnit = d.view;
  const addLine = () => {
    set({ lines: [...d.lines, { materialId: "", amount: "", src: unit, diffKind: "pct", diff: defaultDiff, needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true }] });
    setPicking(d.lines.length);
  };
  const totalText = unit === "pct" ? percentTotalText(totals) : gramsTotalText(totals);
  const checkHint =
    weighCheck === "all"
      ? "Your company has a second person check every weighing, so this box is only a reminder."
      : weighCheck === "none"
        ? "Your company does not use second-person weighing checks now; ticking this has no effect until that changes."
        : "Your company checks only the ingredients ticked here (for example lye, colour, extract, scent, preservative).";

  if (locked) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="rounded-[12px] bg-[var(--appr-bg)] px-3 py-2 text-[14px] text-[var(--appr-fg)]">The ingredients are waiting for approval, so they can&apos;t be changed now. You can still change the steps.</p>
        <ol className="flex flex-col divide-y divide-line">
          {d.lines.map((l, i) => (
            <li key={i} className="py-2 text-[14px]">
              {i + 1}. {matName(l.materialId)} · {fmt(lineGrams(batchG, l), 6)} g · {fmt(percentFromGrams(batchG, lineGrams(batchG, l)))}%
            </li>
          ))}
        </ol>
        {d.packaging.length > 0 && (
          <>
            <h2 className="mt-2 text-[15px] font-semibold">Packaging for each piece</h2>
            <ul className="flex flex-col divide-y divide-line">
              {d.packaging.map((p, i) => (
                <li key={i} className="py-2 text-[14px]">
                  {fmt(p.perPiece, PER_PIECE_DECIMALS)} {matName(p.materialId)} per {pieceWord(family, 1)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <p className="text-[15px]">List everything that goes into one batch of {fmt(d.batchKg, 3)} kg, and how much.</p>
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold">Type amounts in</span>
          <div role="radiogroup" aria-label="Type amounts in" className="inline-flex w-full max-w-sm rounded-full border border-line bg-surface-2 p-1">
            {(["g", "pct"] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={unit === u}
                onClick={() => set({ view: u })}
                className={cx("min-h-[44px] flex-1 rounded-full text-[15px] font-semibold", unit === u ? "bg-surface text-fg shadow" : "text-muted")}
              >
                {u === "g" ? "grams" : "percent"}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted">Switching only changes how amounts are shown; the other number is worked out for you.</p>
        </div>
      </Card>

      {d.lines.length === 0 && <p className="rounded-[16px] border border-dashed border-line-strong p-5 text-center text-[14px] text-muted">No ingredients yet. Press “Add an ingredient”.</p>}

      {d.lines.map((l, i) => {
        const err = (k: string) => errors[`lines.${i}.${k}`];
        const g = lineGrams(batchG, l);
        const other = unit === "g" ? `= ${fmt(percentFromGrams(batchG, g))}% of the batch` : `= ${fmt(g, 6)} g`;
        return (
          <Card key={i} className="flex flex-col gap-3 !p-4" data-testid={`ingredient-${i + 1}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-surface-2 px-2 text-[15px] font-semibold tabular">{i + 1}</span>
              <div className="flex gap-1.5">
                <IconButton label={`Move ingredient ${i + 1} up`} disabled={i === 0} onClick={() => set({ lines: move(d.lines, i, -1) })}>
                  <ArrowUp size={20} />
                </IconButton>
                <IconButton label={`Move ingredient ${i + 1} down`} disabled={i === d.lines.length - 1} onClick={() => set({ lines: move(d.lines, i, 1) })}>
                  <ArrowDown size={20} />
                </IconButton>
                <IconButton label={`Remove ingredient ${i + 1}`} danger onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })}>
                  <Trash2 size={20} />
                </IconButton>
              </div>
            </div>
            {picking === i || !l.materialId ? (
              <IngredientPicker
                materials={materials}
                canCreate={canCreate}
                onPick={(id) => {
                  setLine(i, { materialId: id });
                  setPicking(null);
                }}
                onCreated={(m) => {
                  onMaterialCreated(m);
                  setLine(i, { materialId: m.id });
                  setPicking(null);
                }}
                onCancel={l.materialId ? () => setPicking(null) : undefined}
              />
            ) : (
              <button type="button" onClick={() => setPicking(i)} className="flex min-h-[48px] items-center justify-between rounded-[14px] border border-line px-3 text-left">
                <span className="text-[16px] font-semibold">{matName(l.materialId)}</span>
                <span className="text-[13px] text-primary-text">Change</span>
              </button>
            )}
            <ErrorText text={err("materialId")} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`amt-${i}`} className="text-[14px] font-semibold">
                  Amount
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`amt-${i}`}
                    inputMode="decimal"
                    className="text-[18px] font-semibold"
                    value={lineShown(batchG, l, unit)}
                    onChange={(e) => setLine(i, { amount: e.target.value.replace(",", "."), src: unit })}
                  />
                  <span className="w-6 text-[17px] font-medium">{unit === "g" ? "g" : "%"}</span>
                </div>
                <p className="text-[13px] text-muted tabular">{l.amount ? other : ""}</p>
                <ErrorText text={err("quantityG")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`diff-${i}`} className="text-[14px] font-semibold">
                  Allowed difference when weighing
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[17px]">±</span>
                  <Input id={`diff-${i}`} inputMode="decimal" className="w-28" value={l.diff} onChange={(e) => setLine(i, { diff: e.target.value.replace(",", ".") })} />
                  <Select aria-label="Allowed difference in" className="w-24" value={l.diffKind} onChange={(e) => setLine(i, { diffKind: e.target.value as "pct" | "g" })}>
                    <option value="pct">%</option>
                    <option value="g">g</option>
                  </Select>
                </div>
                <ErrorText text={err("tolerancePct") ?? err("toleranceAbsG")} />
                <WhatIsThis>
                  Nobody weighs exactly. This says how far the scale may be from the amount and still be OK. ±2% of 1,000 g means anything from 980 g to 1,020 g is fine. The person who approves the recipe checks this number. (Detailed screens call it &quot;tolerance&quot;.)
                </WhatIsThis>
              </div>
            </div>
            <label className="flex min-h-[44px] items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={l.needsCheck} onChange={(e) => setLine(i, { needsCheck: e.target.checked })} />
              <span>
                <b>Needs a second person to check the weighing</b>
                <span className="block text-[12px] text-muted">{checkHint}</span>
              </span>
            </label>
          </Card>
        );
      })}

      <Button type="button" variant="secondary" size="lg" onClick={addLine}>
        <Plus size={20} aria-hidden /> Add an ingredient
      </Button>
      <p className="text-[13px] text-muted">Wrappers, labels, bottles and boxes are not ingredients: add them below under “Packaging for each piece”.</p>

      <div
        role="status"
        className={cx(
          "rounded-[14px] border px-4 py-3 text-[16px] font-semibold",
          totals.exact ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]",
        )}
        data-testid="ingredient-total"
      >
        {d.lines.length ? totalText : "Add the ingredients."}
        {unit === "g" && d.lines.length > 0 && !totals.exact && <span className="block text-[12px] font-normal">That is allowed in grams, but check it. In percent the total must be exactly 100%.</span>}
      </div>
      <ErrorText text={errors.lines} />

      <PackagingSection d={d} set={set} errors={errors} materials={materials} matName={matName} canCreate={canCreate} onMaterialCreated={onMaterialCreated} pieces={pieces} family={family} />
    </div>
  );
}

/**
 * "Packaging for each piece" (ADR-092): wrappers, labels, bottles, boxes. Saved as the recipe's
 * packaging lines (packaging items, counted in pieces, scaling with the batch), so they are set aside
 * and listed on "Get materials". Never weighed and never in the ingredient total.
 */
function PackagingSection({
  d,
  set,
  errors,
  materials,
  matName,
  canCreate,
  onMaterialCreated,
  pieces,
  family,
}: {
  d: WDraft;
  set: (p: Partial<WDraft>) => void;
  errors: Errors;
  materials: Material[];
  matName: (id: string) => string;
  canCreate: boolean;
  onMaterialCreated: (m: Material) => void;
  pieces: string;
  family: string | null;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const one = pieceWord(family, 1);
  const many = pieceWord(family);
  const setItem = (i: number, patch: Partial<RecipePackagingDraft>) => set({ packaging: d.packaging.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const add = () => {
    set({ packaging: [...d.packaging, { materialId: "", perPiece: "1", from: null, keep: packagingKeep() }] });
    setPicking(d.packaging.length);
  };
  const known = pieces !== "0";
  return (
    <section aria-labelledby="pk-title" className="mt-2 flex flex-col gap-3">
      <Card className="flex flex-col gap-1">
        <h2 id="pk-title" className="text-[18px] font-semibold">
          Packaging for each piece
        </h2>
        <p className="text-[14px] text-muted">
          The wrapper, label, bottle or box each {one} needs. They are set aside with the ingredients and listed on “Get materials”; nobody weighs them.
          {known ? ` One batch makes ${Number(pieces).toLocaleString("en-PH")} ${many}.` : ""}
        </p>
        {!known && <p className="text-[13px] text-[var(--warn-fg)]">To count packaging, the system needs the pieces per batch: on screen 2 choose “By pieces”, or give the weight of one piece.</p>}
      </Card>
      {d.packaging.map((p, i) => {
        const err = (k: string) => errors[`packaging.${i}.${k}`];
        const qty = known ? packagingQty(pieces, p) : "0";
        return (
          <Card key={i} className="flex flex-col gap-3 !p-4" data-testid={`packaging-${i + 1}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-9 items-center rounded-full bg-surface-2 px-3 text-[13px] font-semibold">Packaging {i + 1}</span>
              <IconButton label={`Remove packaging ${i + 1}`} danger onClick={() => set({ packaging: d.packaging.filter((_, j) => j !== i) })}>
                <Trash2 size={20} />
              </IconButton>
            </div>
            {picking === i || !p.materialId ? (
              <IngredientPicker
                mode="packaging"
                materials={materials}
                canCreate={canCreate}
                onPick={(id) => {
                  setItem(i, { materialId: id });
                  setPicking(null);
                }}
                onCreated={(m) => {
                  onMaterialCreated(m);
                  setItem(i, { materialId: m.id });
                  setPicking(null);
                }}
                onCancel={p.materialId ? () => setPicking(null) : undefined}
              />
            ) : (
              <button type="button" onClick={() => setPicking(i)} className="flex min-h-[48px] items-center justify-between rounded-[14px] border border-line px-3 text-left">
                <span className="text-[16px] font-semibold">{matName(p.materialId)}</span>
                <span className="text-[13px] text-primary-text">Change</span>
              </button>
            )}
            <ErrorText text={err("materialId")} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`pk-${i}`} className="text-[14px] font-semibold">
                How many per {one}?
              </label>
              <Input
                id={`pk-${i}`}
                inputMode="decimal"
                className="w-28 text-[18px] font-semibold"
                value={p.perPiece}
                onChange={(e) => setItem(i, { perPiece: e.target.value.replace(",", "."), from: null })}
              />
              <p className="text-[13px] text-muted tabular">{known && Number(qty) > 0 ? `= ${fmt(qty, 6)} for one batch` : ""}</p>
              <ErrorText text={err("perPiece")} />
            </div>
          </Card>
        );
      })}
      <Button type="button" variant="secondary" size="lg" onClick={add}>
        <Plus size={20} aria-hidden /> Add packaging (wrapper, label, bottle, box)
      </Button>
      <ErrorText text={errors.packaging} />
    </section>
  );
}

function IngredientPicker({
  materials,
  canCreate,
  onPick,
  onCreated,
  onCancel,
  mode = "ingredient",
}: {
  materials: Material[];
  canCreate: boolean;
  onPick: (id: string) => void;
  onCreated: (m: Material) => void;
  onCancel?: () => void;
  /** ingredient: raw materials and intermediates (weighed); packaging: packaging items (counted in pieces). */
  mode?: "ingredient" | "packaging";
}) {
  const [q, setQ] = useState("");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const term = q.trim().toLowerCase();
  const pk = mode === "packaging";
  // Ingredients are weighed into a batch; packaging is counted per piece. Spare parts and other consumables are neither.
  const kindOk = (k: string) => (pk ? k === "packaging" : k === "raw_material" || k === "intermediate");
  const shown = materials.filter((m) => kindOk(m.kind) && (!term || `${m.name} ${m.code}`.toLowerCase().includes(term))).slice(0, 30);
  const W = pk
    ? { search: "Search packaging", ph: "Type the name, like wrapper", none: "No packaging item with that name.", newLabel: "New packaging item name", newPh: "Soap wrapper 135 g", note: "It is counted in pieces. Add the supplier and details later under Materials.", add: "Add this packaging item", adding: "Adding…", start: "Add a new packaging item" }
    : { search: "Search ingredients", ph: "Type the ingredient name", none: "No ingredient with that name.", newLabel: "New ingredient name", newPh: "Calamansi Extract", note: "It is weighed in grams. Add the details (INCI name, supplier) later under Materials.", add: "Add this ingredient", adding: "Adding…", start: "Add a new ingredient" };
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface-2/60 p-3">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label={W.search} autoFocus placeholder={W.ph} value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {shown.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onPick(m.id)} className="flex min-h-[44px] w-full items-center justify-between rounded-[10px] px-3 text-left hover:bg-surface">
              <span className="text-[15px] font-medium">{m.name}</span>
              <span className="text-[12px] text-muted">
                {m.code}
                {m.status === "draft" ? " · draft" : ""}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-2 text-[14px] text-muted">{W.none}</li>}
      </ul>
      {canCreate &&
        (making ? (
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <label htmlFor={pk ? "np-pk-name" : "ni-name"} className="text-[14px] font-semibold">
              {W.newLabel}
            </label>
            <Input id={pk ? "np-pk-name" : "ni-name"} value={name} onChange={(e) => setName(e.target.value)} placeholder={W.newPh} />
            <p className="text-[12px] text-muted">{W.note}</p>
            {msg && <ErrorText text={msg} />}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="cta"
                disabled={pending || !name.trim()}
                onClick={() =>
                  start(async () => {
                    const r = pk ? await createRecipePackagingAction({ name }) : await createRecipeIngredientAction({ name });
                    if (!r.ok || !r.data) {
                      setMsg(r.message ?? "Not saved.");
                      return;
                    }
                    onCreated(r.data);
                  })
                }
              >
                {pending ? W.adding : W.add}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMaking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMaking(true);
              setName(q);
            }}
          >
            <Plus size={18} aria-hidden /> {W.start}
          </Button>
        ))}
      {onCancel && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X size={18} aria-hidden /> Keep the one I had
        </Button>
      )}
    </div>
  );
}

/* ================================================================== 4. steps */

function StepsScreen({ d, set, setStep, errors, locked }: { d: WDraft; set: (p: Partial<WDraft>) => void; setStep: (i: number, p: Partial<RecipeStepDraft>) => void; errors: Errors; locked: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (locked) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="rounded-[12px] bg-[var(--appr-bg)] px-3 py-2 text-[14px] text-[var(--appr-fg)]">The steps are waiting for approval, so they can&apos;t be changed now. You can still change the ingredients.</p>
        <ol className="flex flex-col gap-1">
          {d.steps.map((s, i) => (
            <li key={i} className="text-[14px]">
              {stepPreviewLine(s, i, d.steps.length)}
            </li>
          ))}
        </ol>
      </Card>
    );
  }
  const add = (key: (typeof RECIPE_BLOCKS)[number]["key"]) => {
    set({ steps: [...d.steps, newStep(key)] });
    setOpen(d.steps.length);
  };
  return (
    <div className="flex flex-col gap-3">
      {d.steps.length === 0 && <p className="rounded-[16px] border border-dashed border-line-strong p-5 text-center text-[14px] text-muted">No steps yet. Tap a block below to add the first step.</p>}
      <ol className="flex flex-col gap-3">
        {d.steps.map((s, i) => {
          const isOpen = open === i || Object.keys(errors).some((k) => k.startsWith(`steps.${i}.`));
          return (
            <li key={i}>
              <Card className="flex flex-col gap-3 !p-4" data-testid={`step-${i + 1}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={() => setOpen(isOpen ? null : i)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={isOpen}>
                    <BlockIcon block={s.block} />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold">{stepPreviewLine(s, i, d.steps.length)}</span>
                      <span className="block text-[12px] text-primary-text">{isOpen ? "Close" : "Change"}</span>
                    </span>
                  </button>
                  <div className="flex justify-end gap-1.5">
                    <IconButton label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => set({ steps: move(d.steps, i, -1) })}>
                      <ArrowUp size={20} />
                    </IconButton>
                    <IconButton label={`Move step ${i + 1} down`} disabled={i === d.steps.length - 1} onClick={() => set({ steps: move(d.steps, i, 1) })}>
                      <ArrowDown size={20} />
                    </IconButton>
                    <IconButton
                      label={`Copy step ${i + 1}`}
                      onClick={() => set({ steps: [...d.steps.slice(0, i + 1), { ...structuredClone(s), keep: { ...s.keep, code: null } }, ...d.steps.slice(i + 1)] })}
                    >
                      <Copy size={20} />
                    </IconButton>
                    <IconButton label={`Remove step ${i + 1}`} danger onClick={() => set({ steps: d.steps.filter((_, j) => j !== i) })}>
                      <Trash2 size={20} />
                    </IconButton>
                  </div>
                </div>
                {isOpen && <StepFields s={s} i={i} setStep={setStep} errors={errors} />}
              </Card>
            </li>
          );
        })}
      </ol>
      <section aria-label="Add a step" className="flex flex-col gap-2">
        <h2 className="text-[17px] font-semibold">Add a step</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RECIPE_BLOCKS.map((b) => (
            <button key={b.key} type="button" onClick={() => add(b.key)} className="flex min-h-[64px] items-center gap-3 rounded-[14px] border border-line bg-surface px-3 text-left hover:bg-surface-2" title={b.help}>
              <BlockIcon block={b.key} />
              <span className="text-[14px] font-semibold leading-tight">{b.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ErrorText text={errors.steps} />
    </div>
  );
}

function StepFields({ s, i, setStep, errors }: { s: RecipeStepDraft; i: number; setStep: (i: number, p: Partial<RecipeStepDraft>) => void; errors: Errors }) {
  const err = (k: string) => errors[`steps.${i}.${k}`];
  const isWait = s.stepKind === "curing" || s.stepKind === "hold";
  const setReading = (k: number, patch: Partial<RecipeReadingDraft>) => setStep(i, { readings: s.readings.map((r, j) => (j === k ? { ...r, ...patch } : r)) });
  const readingErr = (k: number) => Object.entries(errors).find(([key]) => key.startsWith(`steps.${i}.parameters.${k}.`))?.[1];
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`sn-${i}`} className="text-[14px] font-semibold">
          Name of the step
        </label>
        <Input id={`sn-${i}`} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} />
        <ErrorText text={err("name")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`si-${i}`} className="text-[14px] font-semibold">
          What to do <span className="font-normal text-muted">(optional)</span>
        </label>
        <Textarea id={`si-${i}`} value={s.instruction} placeholder="Tell the worker what to do, in short sentences." onChange={(e) => setStep(i, { instruction: e.target.value })} />
        <ErrorText text={err("instruction")} />
      </div>

      {isWait && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">How long to wait (at least)</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="How long" inputMode="decimal" className="w-28 text-[18px]" value={s.waitAmount} onChange={(e) => setStep(i, { waitAmount: e.target.value.replace(",", ".") })} />
            <Select aria-label="Unit" className="w-36" value={s.waitUnit} onChange={(e) => setStep(i, { waitUnit: e.target.value as RecipeStepDraft["waitUnit"] })}>
              {WAIT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
          <ErrorText text={err("minDurationMinutes")} />
          <div role="radiogroup" aria-label="Kind of wait" className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            {(
              [
                ["curing", "Curing (soap getting hard)"],
                ["hold", "Resting (a shorter wait)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                <input type="radio" className="h-5 w-5" name={`wait-${i}`} checked={s.stepKind === k} onChange={() => setStep(i, { stepKind: k })} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[12px] text-muted">The batch can&apos;t go to the next step before this time is over. Ending early needs an approver and a reason.</p>
        </div>
      )}

      {s.stepKind === "line_clearance" && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`sa-${i}`} className="text-[14px] font-semibold">
            Which area?
          </label>
          <Select id={`sa-${i}`} value={s.area} onChange={(e) => setStep(i, { area: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(AREAS_WORDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <ErrorText text={err("area")} />
          <span className="text-[14px] font-semibold">Things to check (optional)</span>
          {s.checklist.map((c, k) => (
            <div key={k} className="flex items-center gap-2">
              <Input aria-label={`Thing to check ${k + 1}`} value={c.text} onChange={(e) => setStep(i, { checklist: s.checklist.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
              <IconButton label={`Remove thing to check ${k + 1}`} danger onClick={() => setStep(i, { checklist: s.checklist.filter((_, j) => j !== k) })}>
                <Trash2 size={18} />
              </IconButton>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => setStep(i, { checklist: [...s.checklist, { text: "", requiresPhoto: false, isBlocking: true }] })}>
            <Plus size={18} aria-hidden /> Add a thing to check
          </Button>
        </div>
      )}

      {s.stepKind !== "transfer" && s.stepKind !== "dispensing" && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">Things to write down (optional)</span>
          <p className="text-[12px] text-muted">For example the temperature. If you give a lowest and highest number, the screen warns the worker when the number is outside.</p>
          {s.readings.map((r, k) => (
            <div key={k} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <Input aria-label={`What to write down ${k + 1}`} placeholder="Temperature" value={r.name} onChange={(e) => setReading(k, { name: e.target.value })} />
                <Select aria-label="Kind of answer" value={r.kind} onChange={(e) => setReading(k, { kind: e.target.value as RecipeReadingDraft["kind"] })}>
                  <option value="number">a number</option>
                  <option value="yesno">yes or no</option>
                  <option value="text">a short note</option>
                </Select>
                <IconButton label={`Remove ${r.name || "this"}`} danger onClick={() => setStep(i, { readings: s.readings.filter((_, j) => j !== k) })}>
                  <Trash2 size={18} />
                </IconButton>
              </div>
              {r.kind === "number" && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] text-muted">Unit</span>
                    <Input aria-label="Unit" placeholder="°C" value={r.unit} onChange={(e) => setReading(k, { unit: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] text-muted">Lowest OK</span>
                    <Input aria-label="Lowest OK" inputMode="decimal" placeholder="60" value={r.min} onChange={(e) => setReading(k, { min: e.target.value.replace(",", ".") })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] text-muted">Highest OK</span>
                    <Input aria-label="Highest OK" inputMode="decimal" placeholder="70" value={r.max} onChange={(e) => setReading(k, { max: e.target.value.replace(",", ".") })} />
                  </div>
                </div>
              )}
              <label className="flex min-h-[40px] items-center gap-2 text-[13px]">
                <input type="checkbox" className="h-5 w-5" checked={r.required} onChange={(e) => setReading(k, { required: e.target.checked })} />
                Must be filled in
              </label>
              <ErrorText text={readingErr(k)} />
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => setStep(i, { readings: [...s.readings, { name: "", kind: "number", unit: "", min: "", max: "", target: "", code: "", required: true }] })}>
            <Plus size={18} aria-hidden /> Add something to write down
          </Button>
          <ErrorText text={err("parameters")} />
        </div>
      )}

      <label className="flex min-h-[44px] items-start gap-3 text-[14px]">
        <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={s.needsCheck} onChange={(e) => setStep(i, { needsCheck: e.target.checked })} />
        <span>
          <b>Needs a second person to check</b>
          <span className="block text-[12px] text-muted">Another person looks and signs before the step counts as done.</span>
        </span>
      </label>
      {(s.keep.workInstructionRevisionId || s.keep.requiresEquipment) && (
        <p className="text-[12px] text-muted">This step also has settings from advanced editing (a linked instruction or equipment); they are kept.</p>
      )}
    </div>
  );
}
