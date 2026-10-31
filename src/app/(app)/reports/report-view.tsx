import Link from "next/link";
import type { ReportOutput } from "@/modules/reports";
import { EmptyState, Table, Td, cx } from "@/ui/core";
import { MoreDetails } from "@/ui/guide";
import { Banner, Chip } from "@/ui/status";

/** On-screen report output: header block, table (drill-down links), totals and footnotes. */
export function ReportHeader({ out }: { out: ReportOutput }) {
  const items: [string, string][] = [...out.filters, ["Made at", out.generatedAtText], ["Made by", out.generatedBy], ["Rows", String(out.rowCount)]];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
          <dd className="break-words text-fg">{v}</dd>
        </div>
      ))}
      <div className="min-w-0 sm:col-span-2 lg:col-span-3">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">How fresh</dt>
        <dd className="flex flex-wrap items-center gap-2 text-fg">
          <Chip tone="ok">{out.valueLabel}</Chip>
          <span>{out.freshness}</span>
          {out.personalData && <Chip tone="info">Contains personal data</Chip>}
        </dd>
      </div>
    </dl>
  );
}

export function ReportTable({ out, screenCap }: { out: ReportOutput; screenCap: boolean }) {
  return (
    <>
      {out.truncated && (
        <Banner tone="warn" title={screenCap ? `Showing the first ${out.cap.toLocaleString("en-PH")} rows` : `Truncated at ${out.cap.toLocaleString("en-PH")} rows`}>
          {screenCap ? "The export holds up to the export row limit; narrow the filters to see everything on screen." : "Narrow the filters for the rest."}
        </Banner>
      )}
      {out.rows.length === 0 ? (
        <EmptyState title="Nothing matches">Try longer dates (for example “This month”), another site, or fewer filters.</EmptyState>
      ) : (
        <>
          {/* Phones and small tablets: one card per row, the first column as the title (no sideways scroll). */}
          <ul aria-label="Rows" className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line md:hidden">
            {out.rows.map((r, i) => {
              // The row's "what" first (item, product, customer, title), not the site code; then the rest.
              const head = out.columns.find((c) => /^(item|product|customer|title|name|supplier)/i.test(c.key) || /^(item|product|customer|title|supplier)/i.test(c.header)) ?? out.columns[0];
              const rest = out.columns.filter((c) => c !== head);
              const title = r[head.key] ?? "—";
              return (
                <li key={i} className="px-4 py-3">
                  <p className="break-words text-[15px] font-semibold text-fg">
                    {out.links[i] ? (
                      <Link href={out.links[i]!} className="text-primary-text hover:underline">
                        {title}
                      </Link>
                    ) : (
                      title
                    )}
                  </p>
                  <dl className="mt-1 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
                    {rest
                      .filter((c) => (r[c.key] ?? "") !== "")
                      .map((c) => (
                        <div key={c.key} className="contents">
                          <dt className="text-muted">{c.header}</dt>
                          <dd className={cx("min-w-0 break-words text-fg", c.numeric && "tabular")}>{r[c.key]}</dd>
                        </div>
                      ))}
                  </dl>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <Table head={out.columns.map((c) => c.header)}>
              {out.rows.map((r, i) => (
                <tr key={i}>
                  {out.columns.map((c, j) => (
                    <Td key={c.key} className={cx(c.numeric && "text-right", "whitespace-nowrap")}>
                      {j === 0 && out.links[i] ? (
                        <Link href={out.links[i]!} className="text-primary-text hover:underline">
                          {r[c.key] ?? "—"}
                        </Link>
                      ) : (
                        (r[c.key] ?? "")
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
      {out.summary.length > 0 && (
        <dl className="mt-3 space-y-1 text-[13px]">
          {out.summary.map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-2">
              <dt className="font-semibold">{k}:</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

export function ReportFootnotes({ out }: { out: ReportOutput }) {
  return (
    <MoreDetails title="How this list is made (definitions)">
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-fg-2">
        {out.footnotes.map((f, i) => (
          <li key={i} className="break-words">{f}</li>
        ))}
      </ol>
    </MoreDetails>
  );
}
