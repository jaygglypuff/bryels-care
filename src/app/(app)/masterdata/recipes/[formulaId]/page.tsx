import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { getRecipe, recipeWizardOptions, type RecipeView } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { approvalSentence } from "../../_eng/ui";
import { RecipeSummary } from "../recipe-summary";
import { RecipeWizard } from "../wizard";

export const metadata: Metadata = { title: "Recipe" };

type V = { id: string; no: number; status: string } | null;
const word = (v: V) => (v ? `Version ${v.no} (${v.status === "pending_approval" ? "waiting for approval" : v.status.replace(/_/g, " ")})` : "none yet");

/** Version words for one part (ingredients or steps) when the wizard opens. */
function partLabel(p: { open: V; current: V; next: number } | null, newVersion: boolean) {
  if (!p) return { label: "Version 1 (new draft)", no: 1 };
  if (p.open) return { label: word(p.open), no: p.open.no };
  if (newVersion) return { label: `${word(p.current)} → Version ${p.next} (new draft) if you change them`, no: p.next };
  return { label: word(p.current), no: p.current?.no ?? 1 };
}

/**
 * One recipe in plain words (ADR-089): the summary of the open or current version, with "Edit
 * recipe" for a draft, "Make a new version" for an approved recipe, and the detailed pages as
 * "Advanced editing". Approvals stay on the detailed pages and in "To approve".
 */
export default async function RecipePage({ params, searchParams }: { params: Promise<{ formulaId: string }>; searchParams: Promise<{ edit?: string; new?: string; saved?: string }> }) {
  const { formulaId } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view") || !ctx.can("masterdata.routing.view")) return <Forbidden what="recipes" />;
  const r = await getRecipe(ctx, formulaId);
  if (!r) return <EmptyState title="Recipe not found" action={<LinkButton href="/masterdata/formulas" variant="secondary">All recipes</LinkButton>} />;

  const wantsEdit = sp.edit === "1" && r.mode === "draft" && r.can.edit;
  const wantsNew = sp.new === "1" && r.mode === "approved" && r.can.newVersion && r.can.edit;
  if (wantsEdit || wantsNew) {
    const options = await recipeWizardOptions(ctx);
    const ing = partLabel(r.versions.formula, wantsNew || !r.versions.formula.open);
    const st = partLabel(r.versions.routing, wantsNew || !r.versions.routing?.open);
    return (
      <div className="flex flex-col gap-3">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-between gap-2 text-[13px]">
          <Link href={`/masterdata/recipes/${r.formula.id}`} className="text-primary-text hover:underline">
            ← Back to the recipe without saving
          </Link>
        </div>
        <RecipeWizard
          options={options}
          initial={r.draft}
          start={{
            kind: wantsNew ? "version" : "edit",
            ingredientsLabel: ing.label,
            stepsLabel: st.label,
            formulaNo: ing.no,
            routingNo: st.no,
            locks: r.locks,
            productName: r.product.name,
            materialNames: r.materialNames,
          }}
        />
      </div>
    );
  }
  return <RecipeOverview r={r} saved={sp.saved} />;
}

function RecipeOverview({ r, saved }: { r: RecipeView; saved?: string }) {
  const f = r.versions.formula;
  const ro = r.versions.routing;
  const fShown = f.open ?? f.current;
  const rShown = ro ? (ro.open ?? ro.current) : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/masterdata/formulas" className="text-[13px] text-primary-text hover:underline">
        ← All recipes
      </Link>
      <PageHeader
        title={`Recipe: ${r.product.name}`}
        subtitle={`${r.formula.code} · ingredients ${word(fShown)} · steps ${ro ? word(rShown) : "none yet"}`}
        actions={
          <>
            {r.mode === "draft" && r.can.edit && (
              <LinkButton href={`/masterdata/recipes/${r.formula.id}?edit=1`} variant="cta" size="lg">
                Edit recipe
              </LinkButton>
            )}
            {r.mode === "approved" && r.can.newVersion && r.can.edit && (
              <LinkButton href={`/masterdata/recipes/${r.formula.id}?new=1`} variant="cta" size="lg">
                Make a new version
              </LinkButton>
            )}
          </>
        }
      />
      {saved && (
        <div role="status" className="rounded-[12px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] px-3 py-2 text-[14px] text-[var(--ok-fg)]">
          {saved === "sent" ? "Sent for approval. The approvers see it under “To approve”." : "Saved as a draft. Nobody can use it until it is sent and approved."}
        </div>
      )}
      {r.mode === "waiting" && (
        <p className="rounded-[12px] bg-[var(--appr-bg)] px-3 py-2 text-[14px] text-[var(--appr-fg)]">
          Waiting for approval. {approvalSentence(r.approvalPolicy, "recipe")} It can&apos;t be changed while it waits.
        </p>
      )}
      {r.mode === "approved" && (
        <p className="rounded-[12px] bg-[var(--info-bg)] px-3 py-2 text-[14px] text-[var(--info-fg)]">
          Approved recipes can&apos;t be changed. To change it, press “Make a new version”: the new version is a draft until it is approved, and batches keep using this one until then.
        </p>
      )}
      <Card>
        <RecipeSummary
          productName={r.product.name}
          product={{ unitNetMassG: r.product.unitNetMassG, family: r.product.family, pieceG: r.product.pieceG }}
          draft={r.draft}
          materialName={(id) => r.materialNames[id] ?? "Unknown ingredient"}
          ingredientsLabel={word(fShown)}
          stepsLabel={ro ? word(rShown) : "none yet"}
        />
      </Card>
      <Card>
        <h2 className="text-[15px] font-semibold">Advanced editing and approval</h2>
        <p className="text-[13px] text-muted">The detailed pages show every field, the changes against the last version, and the Approve / Reject buttons for approvers.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {fShown && (
            <LinkButton href={`/masterdata/formulas/${r.formula.id}/revisions/${fShown.id}`} variant="secondary">
              Ingredients in detail
            </LinkButton>
          )}
          {r.routing && rShown && (
            <LinkButton href={`/masterdata/routings/${r.routing.id}/revisions/${rShown.id}`} variant="secondary">
              Steps in detail
            </LinkButton>
          )}
        </div>
      </Card>
    </div>
  );
}
