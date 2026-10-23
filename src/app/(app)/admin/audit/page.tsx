import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { AUDIT_PAGE_SIZE, listAuditEvents, listAuditModules, type AuditRow } from "@/modules/identity";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { actionLabel, actionModule, entityHref, moduleLabel } from "./format";

export const dynamic = "force-dynamic";

type SP = { module?: string; q?: string; before?: string };

function Payload({ r }: { r: AuditRow }) {
  if (r.before == null && r.after == null) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[12px] font-medium text-primary-text">Before / after</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {(["before", "after"] as const).map((k) => (
          <div key={k} className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-surface-2 p-2 font-mono text-[11px] text-fg-2">
              {r[k] == null ? "—" : JSON.stringify(r[k], null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function Entity({ r }: { r: AuditRow }) {
  const href = entityHref(r.entityType, r.entityId);
  const label = r.entityNumber ?? (r.entityId ? r.entityId.slice(0, 8) + "…" : "—");
  return (
    <span className="min-w-0">
      <span className="text-[11px] text-muted">{r.entityType.replace(/_/g, " ")} </span>
      {href ? (
        <Link href={href} className="font-mono text-primary-text hover:underline">
          {label}
        </Link>
      ) : (
        <span className="font-mono">{label}</span>
      )}
    </span>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.audit.view")) return <Forbidden what="the audit log" />;
  const sp = await searchParams;
  const filter = { module: sp.module || undefined, q: sp.q?.trim() || undefined, before: sp.before || undefined };

  let result: Awaited<ReturnType<typeof listAuditEvents>>;
  try {
    result = await listAuditEvents(ctx, filter);
  } catch (e) {
    if (e instanceof DomainError || (e && typeof e === "object" && "issues" in e)) {
      return (
        <>
          <PageHeader title="Audit log" />
          <Banner tone="warn" title="These filters are not valid" action={<LinkButton href="/admin/audit" variant="secondary">Show newest events</LinkButton>}>
            {e instanceof DomainError ? e.message : "Use the module list and a document number of up to 80 characters."}
          </Banner>
        </>
      );
    }
    throw e;
  }
  const modules = await listAuditModules(ctx);
  const siteCode = new Map(ctx.allowedSites.map((s) => [s.id, s.code]));
  const where = (r: AuditRow) => (r.siteId ? (siteCode.get(r.siteId) ?? "—") : "Organization");
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ module: filter.module, q: filter.q, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={`Append-only record of every posted change · ${result.orgWide ? "all sites and organization-level events" : `sites ${ctx.allowedSites.map((s) => s.code).join(", ")}`} · newest first, ${AUDIT_PAGE_SIZE} per page`}
      />

      <Card className="mb-4">
        <form method="get" action="/admin/audit" className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="module" className="text-[13px] font-medium">
              Module
            </label>
            <Select id="module" name="module" defaultValue={filter.module ?? ""}>
              <option value="">All modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {moduleLabel(m)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="q" className="text-[13px] font-medium">
              Document or entity number
            </label>
            <Input id="q" name="q" defaultValue={filter.q ?? ""} placeholder="e.g. B-26-0003, SO-…, LOT-…" maxLength={80} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>
              Filter
            </button>
            {(filter.module || filter.q) && (
              <Link href="/admin/audit" className={buttonClass("secondary")}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
        {result.rows.length === 0 ? (
          <EmptyState title={filter.before ? "No older events" : "No audit events match"} action={(filter.module || filter.q || filter.before) && <LinkButton href="/admin/audit" variant="secondary">Show newest events</LinkButton>}>
            {filter.module || filter.q ? "Try another module or number." : "Events appear as soon as anything is posted."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden lg:block">
              <Table head={["When", "Action", "Record", "Actor", "Site", "Reason"]}>
                {result.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <Td className="whitespace-nowrap text-fg-2">{fmtDateTime(r.occurredAt)}</Td>
                    <Td>
                      <p className="font-medium text-fg">{actionLabel(r.action)}</p>
                      <p className="font-mono text-[11px] text-muted">{r.action}</p>
                      <Payload r={r} />
                    </Td>
                    <Td>
                      <Entity r={r} />
                    </Td>
                    <Td>{r.actorName ?? r.actorLabel ?? "System"}</Td>
                    <Td className="whitespace-nowrap">{where(r)}</Td>
                    <Td className="max-w-[240px] text-fg-2">{r.reason ?? "—"}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-line lg:hidden">
              {result.rows.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-fg-2">{moduleLabel(actionModule(r.action))}</span>
                    <span className="text-[12px] text-muted">{fmtDateTime(r.occurredAt)}</span>
                  </div>
                  <p className="mt-1 font-medium text-fg">{actionLabel(r.action)}</p>
                  <p className="text-[13px]">
                    <Entity r={r} />
                  </p>
                  <p className="text-[12px] text-muted">
                    {r.actorName ?? r.actorLabel ?? "System"} · {where(r)}
                    {r.reason && ` · “${r.reason}”`}
                  </p>
                  <Payload r={r} />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-muted">
                {result.rows.length} event{result.rows.length === 1 ? "" : "s"} on this page
              </span>
              <div className="flex gap-2">
                {filter.before && (
                  <LinkButton href={qs({})} variant="secondary">
                    Newest
                  </LinkButton>
                )}
                {result.nextCursor && (
                  <LinkButton href={qs({ before: result.nextCursor })} variant="secondary">
                    Older events →
                  </LinkButton>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
