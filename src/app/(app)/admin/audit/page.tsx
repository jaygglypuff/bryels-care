import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { listAuditEvents, listAuditModules, type AuditRow } from "@/modules/identity";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { actionLabel, actionModule, entityHref, moduleLabel } from "./format";

export const dynamic = "force-dynamic";

type SP = { module?: string; q?: string; before?: string };

function Payload({ r }: { r: AuditRow }) {
  if (r.before == null && r.after == null)
    return (
      <details className="mt-1">
        <summary className="flex min-h-[40px] cursor-pointer items-center text-[13px] font-medium text-primary-text">Technical name</summary>
        <p className="font-mono text-[11px] text-muted">{r.action}</p>
      </details>
    );
  return (
    <details className="mt-1">
      <summary className="flex min-h-[40px] cursor-pointer items-center text-[13px] font-medium text-primary-text">What changed (before / after)</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <p className="text-[11px] text-muted sm:col-span-2">Technical name: <span className="font-mono">{r.action}</span></p>
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
          <PageHeader title="History of changes" />
          <Banner tone="warn" title="This search did not work" action={<LinkButton href="/admin/audit" variant="secondary">Show the newest</LinkButton>}>
            {e instanceof DomainError ? e.message : "Pick an area from the list and type a record number of up to 80 characters."}
          </Banner>
        </>
      );
    }
    throw e;
  }
  const modules = await listAuditModules(ctx);
  const siteCode = new Map(ctx.allowedSites.map((s) => [s.id, s.code]));
  const where = (r: AuditRow) => (r.siteId ? (siteCode.get(r.siteId) ?? "—") : "Whole company");
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ module: filter.module, q: filter.q, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };

  return (
    <>
      <PageHeader
        title="History of changes"
        subtitle={`${result.orgWide ? "All sites" : ctx.allowedSites.map((s) => s.code).join(", ")} · newest first`}
      />
      <PageIntro>This screen is for the owner and auditors: every change anyone saved, who did it, when and why. Nothing here can be changed or deleted. To find one record, type its number (for example a batch or order number).</PageIntro>

      <Card className="mb-4">
        <form method="get" action="/admin/audit" className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="module" className="text-[13px] font-medium">
              Area
            </label>
            <Select id="module" name="module" defaultValue={filter.module ?? ""}>
              <option value="">All areas</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {moduleLabel(m)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="q" className="text-[13px] font-medium">
              Record number
            </label>
            <Input id="q" name="q" defaultValue={filter.q ?? ""} placeholder="For example a batch or order number" maxLength={80} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>
              Search
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
          <EmptyState title={filter.before ? "Nothing older" : "Nothing found"} action={(filter.module || filter.q || filter.before) && <LinkButton href="/admin/audit" variant="secondary">Show the newest</LinkButton>}>
            {filter.module || filter.q ? "Try another area or check the number." : "Changes appear here as soon as anyone saves something."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden lg:block">
              <Table head={["When", "What happened", "Record", "Who", "Site", "Why"]}>
                {result.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <Td className="whitespace-nowrap text-fg-2">{fmtDateTime(r.occurredAt)}</Td>
                    <Td>
                      <p className="font-medium text-fg">{actionLabel(r.action)}</p>
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
                {result.rows.length} change{result.rows.length === 1 ? "" : "s"} on this page
              </span>
              <div className="flex gap-2">
                {filter.before && (
                  <LinkButton href={qs({})} variant="secondary">
                    Newest
                  </LinkButton>
                )}
                {result.nextCursor && (
                  <LinkButton href={qs({ before: result.nextCursor })} variant="secondary">
                    Older →
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
