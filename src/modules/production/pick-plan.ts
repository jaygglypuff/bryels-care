import Decimal from "decimal.js";

/**
 * ADR-106 §1–3: what to bring for one ingredient, lot by lot in use-first order, with how much from each, where it is,
 * and what stays in an opened container. Pure (unit-tested in tests/unit/pick-plan.test.ts); Get materials and the
 * weigh card both use it, so the weigh card proposes exactly what Get materials said.
 *
 * Input lots are the ingredient's set-aside lots, already in use-first order (first to expire first). `setAside` is what
 * is set aside for the order at that place; `onHand` is what is physically there (the container may hold more).
 */
export type PickLot = { lotId: string; lotNumber: string; place: string; expiresOn: string | null; setAside: string; onHand: string };
export type PickStep = { lotId: string; lotNumber: string; place: string; expiresOn: string | null; take: string; onHand: string; staysBehind: string; all: boolean; text: string };
export type PickPlan = { steps: PickStep[]; short: string; sentence: string };

const n = (v: Decimal.Value) => {
  const d = new Decimal(v).toDecimalPlaces(3);
  return Number(d.toString()).toLocaleString("en-PH", { maximumFractionDigits: 3 });
};

/** "50 kg" from grams when ≥ 1 kg and the base unit is g; "250 g"; "120 pcs". */
export function amountWords(v: Decimal.Value, uom: string): string {
  const d = new Decimal(v);
  if (uom === "g" && d.abs().gte(1000)) return `${n(d.div(1000))} kg`;
  if (uom === "mL" && d.abs().gte(1000)) return `${n(d.div(1000))} L`;
  return `${n(d)} ${uom}`;
}

const expiryWords = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(`${iso}T04:00:00Z`);
  return `expires ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" })}`;
};

/** `counted`: packaging (wrappers, labels) is counted out, not weighed. */
export function pickPlan(need: Decimal.Value, uom: string, lots: PickLot[], opts: { counted?: boolean } = {}): PickPlan {
  let left = Decimal.max(new Decimal(need), 0);
  const steps: PickStep[] = [];
  for (const l of lots) {
    if (left.lte(0)) break;
    const avail = Decimal.min(new Decimal(l.setAside), new Decimal(l.onHand));
    if (avail.lte(0)) continue;
    const take = Decimal.min(avail, left);
    const onHand = new Decimal(l.onHand);
    const stays = Decimal.max(onHand.minus(take), 0);
    const all = stays.eq(0);
    const where = [l.place, expiryWords(l.expiresOn)].filter(Boolean).join(", ");
    const text = all
      ? `take all ${amountWords(take, uom)} of lot ${l.lotNumber} (${where})`
      : `bring lot ${l.lotNumber} (${amountWords(onHand, uom)} in it, ${where}). ${opts.counted ? "Count out" : "Weigh out"} ${amountWords(take, uom)}. ${amountWords(stays, uom)} stays for the next batch`;
    steps.push({ lotId: l.lotId, lotNumber: l.lotNumber, place: l.place, expiresOn: l.expiresOn, take: take.toString(), onHand: onHand.toString(), staysBehind: stays.toString(), all, text });
    left = left.minus(take);
  }
  const short = left.gt(0) ? left.toString() : "0";
  const body = steps.map((s) => s.text).join(" + ");
  const sentence = steps.length
    ? `${body.charAt(0).toUpperCase()}${body.slice(1)}.${left.gt(0) ? ` ${amountWords(left, uom)} is not set aside yet.` : ""}`
    : left.gt(0)
      ? `Nothing is set aside yet for ${amountWords(left, uom)}.`
      : "";
  return { steps, short, sentence };
}

/** The weigh card's proposal: "from LM-2611-0005: 50 kg, then LM-2611-0013: 50 kg". */
export function weighProposal(plan: PickPlan, uom: string): string | null {
  if (!plan.steps.length) return null;
  return `from ${plan.steps.map((s) => `${s.lotNumber}: ${amountWords(s.take, uom)}`).join(", then ")}`;
}

/** The note QA sees when a weighing used a lot that was not taken at Get materials (ADR-106 §3). */
export function offPlanWarning(taken: string[]): string {
  return `This is not the lot you took at Get materials${taken.length ? ` (${taken.join(", ")})` : ""}. You can continue — QA will see a note.`;
}
