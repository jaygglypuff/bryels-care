import { requireContext } from "@/lib/auth/context";
import { requestFormOptions } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { SubNav } from "../../_ui";
import { RequestForm } from "./request-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask to buy something" };

const plusDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** New purchase request (W04-02) as "Ask to buy something": item by name, how much, needed by, why (ADR-088). */
export default async function NewRequestPage() {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.create")) return <Forbidden what="asking to buy" />;
  const { materials, suppliers } = await requestFormOptions(ctx);
  const prices = ctx.can("masterdata.supplier_price.view");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
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
          />
        </Card>
      )}
    </div>
  );
}
