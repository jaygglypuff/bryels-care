import Link from "next/link";
import { Beaker, Boxes, Factory, MapPin, Package, PackageCheck, ShieldAlert, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { LocationSection } from "@/lib/location-sections";
import { cx } from "@/ui/core";

/** Warehouse section visuals (S6, ADR-077): one icon and colour per section, shared by tiles and headings. */
const ICON: Record<LocationSection, typeof Boxes> = {
  raw_materials: Beaker,
  packaging: Package,
  finished_goods: PackageCheck,
  qa_hold: ShieldAlert,
  returns: Undo2,
  production: Factory,
  other: MapPin,
};
const TONE: Record<LocationSection, string> = {
  raw_materials: "bg-[var(--info-bg,#e8f1ff)] text-[var(--info-fg,#1d4ed8)]",
  packaging: "bg-[var(--neu-bg,#f1f1f4)] text-fg",
  finished_goods: "bg-[var(--ok-bg,#e7f7ee)] text-[var(--ok-fg,#166534)]",
  qa_hold: "bg-[var(--warn-bg,#fff4e0)] text-[var(--warn-fg,#92400e)]",
  returns: "bg-[var(--neu-bg,#f1f1f4)] text-fg",
  production: "bg-[var(--neu-bg,#f1f1f4)] text-fg",
  other: "bg-[var(--neu-bg,#f1f1f4)] text-muted",
};

export function SectionIcon({ section, size = 20 }: { section: LocationSection; size?: number }) {
  const I = ICON[section];
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-[10px] p-2", TONE[section])} aria-hidden>
      <I size={size} />
    </span>
  );
}

/** Big tappable tile: "Raw materials — 12 lots". */
export function SectionTile({ section, label, hint, lots, blockedLots, locations, href }: { section: LocationSection; label: string; hint: string; lots: number; blockedLots: number; locations: number; href: string }) {
  return (
    <Link href={href} className="flex min-h-[96px] min-w-0 items-start gap-3 rounded-[16px] border border-line bg-surface p-4 transition-shadow hover:shadow-[var(--shadow-pop)] active:bg-surface-2" data-testid={`section-tile-${section}`}>
      <SectionIcon section={section} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold leading-tight">{label}</span>
        <span className="mt-1 block text-[22px] font-semibold tabular leading-none">
          {lots} <span className="text-[14px] font-normal text-muted">{lots === 1 ? "lot" : "lots"}</span>
        </span>
        <span className="mt-1 block text-[12px] text-muted">
          {locations} {locations === 1 ? "place" : "places"}
          {blockedLots > 0 ? ` · ${blockedLots} not ready to use` : ""}
        </span>
        <span className="sr-only">{hint}</span>
      </span>
    </Link>
  );
}

/** Heading above a group of stock rows: icon, name, count and a short hint. */
export function SectionHeading({ section, label, hint, count, unit = "lot", action }: { section: LocationSection; label: string; hint?: string; count: number; unit?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <SectionIcon section={section} />
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold leading-tight" id={`section-${section}`}>
            {label} <span className="font-normal text-muted">· {count} {count === 1 ? unit : `${unit}s`}</span>
          </h2>
          {hint && <p className="text-[12px] text-muted">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
