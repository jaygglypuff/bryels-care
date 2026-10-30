import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { LISTS_ELSEWHERE, listLookupLists } from "@/modules/masterdata";
import { Card, CardTitle, Input, PageHeader } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Help } from "@/ui/help/help";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { addLookupValueAction, deleteLookupValueAction, moveLookupValueAction, renameLookupValueAction, setLookupValueActiveAction } from "./actions";

export const metadata = { title: "Lists" };

/**
 * Master data → Lists (ADR-076): every dropdown list the owner may change, in one place. Options are
 * added, renamed, moved and turned off here; an option in use is never deleted. Lists that drive how
 * the program works (statuses, location kinds, material class) are fixed and not shown.
 */
export default async function ListsPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.lookup_value.view")) return <Forbidden what="lists" />;
  const sp = await searchParams;
  const lists = await listLookupLists(ctx);
  const canAdmin = ctx.can("masterdata.lookup_value.admin");
  const elsewhere = LISTS_ELSEWHERE.filter((l) => ctx.can(l.permission));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Lists" subtitle="The choices shown in dropdowns. Add an option, rename it, move it up or down, or turn it off. Old records keep their option." actions={<Help screen="masterdata.lists" />} />
      <nav aria-label="Lists on this page" className="flex flex-wrap gap-2">
        {lists.map((l) => (
          <a key={l.key} href={`#list-${l.key}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-4 text-[14px] font-medium hover:bg-surface-2">
            {l.title}
          </a>
        ))}
      </nav>
      {lists.map((l) => {
        const activeCount = l.values.filter((v) => v.isActive).length;
        return (
          <Card key={l.key} id={`list-${l.key}`} className={sp.list === l.key ? "ring-2 ring-[var(--lime-200)]" : undefined}>
            <CardTitle>{l.title}</CardTitle>
            <p className="text-[14px] text-muted">
              {l.description} Used on: {l.usedOn}. {activeCount} in use{l.values.length > activeCount ? `, ${l.values.length - activeCount} turned off` : ""}.
            </p>
            <ul className="mt-3 divide-y divide-line">
              {l.values.map((v, i) => (
                <li key={v.code} className="py-3" data-testid={`lookup-${l.key}-${v.code}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={v.isActive ? "text-[15px] font-medium" : "text-[15px] font-medium text-muted line-through"}>{v.label}</p>
                      <p className="text-[12px] text-muted">
                        {v.inUse > 0 ? `Used by ${v.inUse} record${v.inUse === 1 ? "" : "s"}` : "Not used yet"}
                        {!v.isActive && " · turned off"}
                      </p>
                    </div>
                    {!v.isActive && <Chip tone="neu">Off</Chip>}
                  </div>
                  {canAdmin && (
                    <details className="mt-2">
                      <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Change</summary>
                      <div className="mt-2 grid gap-3 rounded-[12px] border border-line p-3">
                        <ActionForm action={renameLookupValueAction} hidden={{ listKey: l.key, code: v.code }} submit="Save name" variant="secondary" className="flex flex-wrap items-start gap-2">
                          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px]">
                            Name people see
                            <Input name="label" defaultValue={v.label} maxLength={60} required autoComplete="off" />
                          </label>
                        </ActionForm>
                        <div className="flex flex-wrap gap-2">
                          {i > 0 && (
                            <ActionForm action={moveLookupValueAction} hidden={{ listKey: l.key, code: v.code, direction: "up" }} submit="Move up" variant="secondary" pending="Moving…" className="flex flex-col gap-1" messageBelow />
                          )}
                          {i < l.values.length - 1 && (
                            <ActionForm action={moveLookupValueAction} hidden={{ listKey: l.key, code: v.code, direction: "down" }} submit="Move down" variant="secondary" pending="Moving…" className="flex flex-col gap-1" messageBelow />
                          )}
                          <ActionForm
                            action={setLookupValueActiveAction}
                            hidden={{ listKey: l.key, code: v.code, active: v.isActive ? "false" : "true" }}
                            submit={v.isActive ? "Turn off" : "Turn on"}
                            variant="secondary"
                            className="flex flex-col gap-1"
                            messageBelow
                          />
                          {v.inUse === 0 && (
                            <ActionForm action={deleteLookupValueAction} hidden={{ listKey: l.key, code: v.code }} submit="Delete" variant="danger" pending="Deleting…" confirm={`Delete "${v.label}"? It is not used anywhere yet.`} className="flex flex-col gap-1" messageBelow />
                          )}
                        </div>
                        {v.inUse > 0 && <p className="text-[12px] text-muted">In use, so it cannot be deleted. Turn it off to stop offering it.</p>}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {canAdmin && (
              <ActionForm action={addLookupValueAction} hidden={{ listKey: l.key }} submit="Add option" pending="Adding…" className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px]">
                  New option
                  <Input name="label" maxLength={60} required autoComplete="off" placeholder={l.key === "product_family" ? "e.g. Shampoo" : l.key === "material_category" ? "e.g. Clays" : "Name"} />
                </label>
              </ActionForm>
            )}
          </Card>
        );
      })}
      {elsewhere.length > 0 && (
        <Card>
          <CardTitle>Lists with their own screen</CardTitle>
          <ul className="mt-2 divide-y divide-line">
            {elsewhere.map((l) => (
              <li key={l.href} className="py-3">
                <Link href={l.href} className="inline-flex min-h-[44px] items-center text-[15px] font-medium text-primary-text hover:underline">
                  {l.title}
                </Link>
                <p className="text-[13px] text-muted">{l.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-[13px] text-muted">
        Some lists are fixed because the program works with them: statuses, location types and material class. They are not shown here.
      </p>
    </div>
  );
}
