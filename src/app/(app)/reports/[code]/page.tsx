import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { PERIOD_LABELS, PERIOD_PRESETS, type ReportOutput, canSeeReport, listReportLibrary, reportByCode, runReport } from "@/modules/reports";
import { Card, Field, Input, LinkButton, PageHeader, Select, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ReportFootnotes, ReportHeader, ReportTable } from "../report-view";
import { ReportAdminForm } from "./forms";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Run one report with filters (GET form, shareable URL); export, print and schedule from here (US-5-04). */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  const { code } = await params;
  const def = reportByCode(code);
  if (!def) notFound();
  if (!ctx.can("analytics.report.view") || (!canSeeReport(ctx, def) && !ctx.can("analytics.report.admin"))) return <Forbidden what="this report" />;
  const sp = await searchParams;
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (first(v) !== "" && k !== "format") raw[k] = first(v);

  let out: ReportOutput | null = null;
  let problem: { title: string; message: string; fieldErrors: Record<string, string> } | null = null;
  try {
    out = await runReport(ctx, code, raw);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "not_found" && !raw.site) notFound();
    problem = {
      title: e.code === "validation" ? "Check the filters" : e.code === "state" ? "Report switched off" : e.code === "forbidden" ? "Not available for your role" : "Not available",
      message: e.message,
      fieldErrors: (e.details?.fieldErrors as Record<string, string>) ?? {},
    };
  }
  const qs = new URLSearchParams(out?.params ?? raw).toString();
  const canExport = ctx.can("analytics.report.export") && (!def.exportPermission || ctx.can(def.exportPermission));
  const fe = problem?.fieldErrors ?? {};
  const sites = ctx.allowedSites.filter((s) => ctx.canAt(def.viewPermission, s.id));
  const hasPeriod = def.params.some((p) => p.kind === "period");
  const adminEntry = ctx.can("analytics.report.admin") ? (await listReportLibrary(ctx)).find((e) => e.def.code === code) : undefined;
  const period = raw.period ?? def.params.find((p) => p.kind === "period")?.default;

  return (
    <div className="space-y-5">
      <PageHeader
        title={def.title}
        subtitle={<><span className="font-mono">{def.code}</span> · {def.description}</>}
        actions={
          out && (
            <>
              {canExport && (
                <>
                  <a className={buttonClass("secondary", "sm")} href={`/reports/${code}/export?${qs}${qs ? "&" : ""}format=csv`}>CSV</a>
                  <a className={buttonClass("secondary", "sm")} href={`/reports/${code}/export?${qs}${qs ? "&" : ""}format=xlsx`}>Excel</a>
                  <a className={buttonClass("secondary", "sm")} href={`/print/reports/${code}${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">Print / PDF</a>
                </>
              )}
              {def.schedulable && ctx.can("analytics.scheduled_report.create") && <LinkButton href={`/reports/schedules/new?report=${code}${qs ? `&${qs}` : ""}`} size="sm">Schedule</LinkButton>}
            </>
          )
        }
      />

      <Card>
        <form method="get" action={`/reports/${code}`} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label="Site" htmlFor="site" error={fe.site}>
            <Select id="site" name="site" defaultValue={raw.site ?? "all"}>
              <option value="all">All my sites ({sites.map((s) => s.code).join(", ")})</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
              ))}
            </Select>
          </Field>
          {def.params.map((p) =>
            p.kind === "period" ? (
              <Field key={p.name} label={p.label} htmlFor="period" error={fe.period}>
                <Select id="period" name="period" defaultValue={period}>
                  {PERIOD_PRESETS.map((x) => (
                    <option key={x} value={x}>{PERIOD_LABELS[x]}</option>
                  ))}
                </Select>
              </Field>
            ) : p.kind === "select" ? (
              <Field key={p.name} label={p.label} htmlFor={p.name} error={fe[p.name]}>
                <Select id={p.name} name={p.name} defaultValue={raw[p.name] ?? p.default}>
                  {p.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            ) : p.kind === "text" ? (
              <Field key={p.name} label={p.label} htmlFor={p.name} error={fe[p.name]}>
                <Input id={p.name} name={p.name} defaultValue={raw[p.name] ?? ""} maxLength={p.maxLength} placeholder={p.placeholder} />
              </Field>
            ) : (
              <Field key={p.name} label={p.label} htmlFor={p.name} error={fe[p.name]}>
                <Input id={p.name} name={p.name} type="number" min={p.min} max={p.max} defaultValue={raw[p.name] ?? String(p.default)} />
              </Field>
            ),
          )}
          {hasPeriod && (
            <>
              <Field label="From (custom dates)" htmlFor="from" error={fe.from}>
                <Input id="from" name="from" type="date" defaultValue={raw.from ?? ""} />
              </Field>
              <Field label="To (custom dates)" htmlFor="to" error={fe.to}>
                <Input id="to" name="to" type="date" defaultValue={raw.to ?? ""} />
              </Field>
            </>
          )}
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>Run report</button>
          </div>
        </form>
      </Card>

      {problem && <Banner tone={problem.title === "Check the filters" ? "warn" : "bad"} title={problem.title}>{problem.message}</Banner>}

      {out && (
        <>
          <Card>
            <ReportHeader out={out} />
          </Card>
          <Card>
            <ReportTable out={out} screenCap />
          </Card>
          <ReportFootnotes out={out} />
        </>
      )}

      {adminEntry && <ReportAdminForm code={code} enabled={adminEntry.enabled} ownerNote={adminEntry.ownerNote} />}
    </div>
  );
}
