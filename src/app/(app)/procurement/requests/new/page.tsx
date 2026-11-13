import { requireContext } from "@/lib/auth/context";
import { requestFormOptions } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { SubNav } from "../../_ui";
import { RequestForm, type RequestPrefill } from "./request-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask to buy something" };

const plusDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * New purchase request (W04-02) as "Ask to buy something": item by name, how much, needed by, why (ADR-088).
 * ADR-131: "Ask to buy N" on What to buy opens it filled in (`?material=&qty=&uom=&supplier=&price=&why=`); the values are
 * only suggestions in the form, and the server checks everything when the request is saved.
 */
export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ material?: string; qty?: string; uom?: string; supplier?: string; price?: string; why?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.create")) return <Forbidden what="asking to buy" permission="procurement.purchase_request.create" />;
  const sp = await searchParams;
  const { materials, suppliers } = await requestFormOptions(ctx);
  const prices = ctx.can("masterdata.supplier_price.view");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const prefill: RequestPrefill | null =
    sp.material && UUID.test(sp.material) && materials.some((m) => m.id === sp.material)
      ? {
          materialId: sp.material,
          qty: /^\d+(\.\d+)?$/.test(sp.qty ?? "") ? sp.qty! : "",
          uom: sp.uom && /^[A-Za-z]{1,8}$/.test(sp.uom) ? sp.uom : null,
          supplierId: sp.supplier && suppliers.some((s) => s.id === sp.supplier) ? sp.supplier : null,
          price: prices && /^\d+(\.\d+)?$/.test(sp.price ?? "") ? sp.price! : null,
          why: sp.why ? sp.why.slice(0, 200) : null,
        }
      : null;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ask to buy something" subtitle={`For ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/requests" variant="secondary">All requests</LinkButton>} />
      <PageIntro>This screen is for asking the company to buy an item. Pick it by name, say how much and by when; the manager approves it and purchasing orders it.</PageIntro>
      <SubNav />
      {materials.length === 0 ? (
        <EmptyState title="No items to choose from yet">Items are added under Master data → Items. Ask the administrator or the site manager.</EmptyState>
      ) : (
        <Card>
          <RequestForm
            materials={[...materials].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ id: m.id, name: m.name, code: m.code, baseUom: m.baseUom }))}
            suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
            prices={prices}
            today={today}
            neededBy={plusDays(today, 7)}
            prefill={prefill}
          />
        </Card>
      )}
    </div>
  );
}
