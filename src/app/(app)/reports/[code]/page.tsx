import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { PERIOD_LABELS, PERIOD_PRESETS, type ReportOutput, canSeeReport, listReportLibrary, reportByCode, runReport } from "@/modules/reports";
import { Card, Field, Input, LinkButton, PageHeader, Select, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { plainReport } from "../plain";
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

  const plain = plainReport(def.code, def.title, def.description);
  const field = (p: (typeof def.params)[number]) =>
    p.kind === "period" ? (
      <Field key={p.name} label="Dates" htmlFor="period" error={fe.period}>
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
    );
  const periodParam = def.params.find((p) => p.kind === "period");
  const otherParams = def.params.filter((p) => p.kind !== "period");
  // A filter error opens the folded filters so the message is visible.
  const openMore = Object.keys(fe).some((k) => k !== "site" && k !== "period");
  const exportHref = (format: string) => `/reports/${code}/export?${qs}${qs ? "&" : ""}format=${format}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={plain.title}
        actions={
          out && (canExport || (def.schedulable && ctx.can("analytics.scheduled_report.create"))) ? (
            <>
              {canExport && (
                <a className={buttonClass("cta", "md")} href={`/print/reports/${code}${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">Print</a>
              )}
              <MoreMenu>
                <div className="flex flex-col gap-2">
                  {canExport && (
                    <>
                      <a className={buttonClass("secondary", "sm")} href={exportHref("xlsx")}>Download for Excel</a>
                      <a className={buttonClass("secondary", "sm")} href={exportHref("csv")}>Download as CSV</a>
                    </>
                  )}
                  {def.schedulable && ctx.can("analytics.scheduled_report.create") && (
                    <LinkButton href={`/reports/schedules/new?report=${code}${qs ? `&${qs}` : ""}`} variant="secondary" size="sm">Send it by email regularly</LinkButton>
                  )}
                </div>
              </MoreMenu>
            </>
          ) : undefined
        }
      />
      <PageIntro>This screen is for anyone who needs this list: {plain.text.charAt(0).toLowerCase() + plain.text.slice(1)} Choose the site and the dates, then press “Show the list”.</PageIntro>

      <Card>
        <form method="get" action={`/reports/${code}`} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Site" htmlFor="site" error={fe.site}>
              <Select id="site" name="site" defaultValue={raw.site ?? "all"}>
                <option value="all">All my sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            {periodParam && field(periodParam)}
          </div>
          {(otherParams.length > 0 || hasPeriod) && (
            <MoreDetails title="More filters (you can skip this)" open={openMore}>
              <div className="grid gap-3 sm:grid-cols-2">
                {otherParams.map(field)}
                {hasPeriod && (
                  <>
                    <Field label="From (your own dates)" htmlFor="from" error={fe.from}>
                      <Input id="from" name="from" type="date" defaultValue={raw.from ?? ""} />
                    </Field>
                    <Field label="To (your own dates)" htmlFor="to" error={fe.to}>
                      <Input id="to" name="to" type="date" defaultValue={raw.to ?? ""} />
                    </Field>
                  </>
                )}
              </div>
            </MoreDetails>
          )}
          <div>
            <button type="submit" className={buttonClass("primary")}>Show the list</button>
          </div>
        </form>
      </Card>

      {problem && <Banner tone={problem.title === "Check the filters" ? "warn" : "bad"} title={problem.title}>{problem.message}</Banner>}

      {out && (
        <>
          <Card>
            <p className="mb-3 text-[14px] text-fg-2">
              {out.rowCount.toLocaleString("en-PH")} {out.rowCount === 1 ? "row" : "rows"} · made {out.generatedAtText}
            </p>
            <ReportTable out={out} screenCap />
          </Card>
          <MoreDetails title="About this list (filters, who made it, how fresh)">
            <ReportHeader out={out} />
            <p className="text-[13px] text-muted">Technical name: <span className="font-mono">{def.code}</span> · official title: {def.title}</p>
          </MoreDetails>
          <ReportFootnotes out={out} />
        </>
      )}

      {adminEntry && (
        <MoreDetails title="Switch this list on or off (administrator)">
          <ReportAdminForm code={code} enabled={adminEntry.enabled} ownerNote={adminEntry.ownerNote} />
        </MoreDetails>
      )}
    </div>
  );
}
