import { Blend, CirclePlus, ClipboardCheck, CupSoda, Flame, Hourglass, Milk, Package, Scale, Scissors, Snowflake, Sparkles, Truck, Wrench, type LucideIcon } from "lucide-react";
import { cx } from "@/ui/core";

const ICONS: Record<string, LucideIcon> = {
  weigh: Scale,
  clean: Sparkles,
  heat: Flame,
  mix: Blend,
  cool: Snowflake,
  add: CirclePlus,
  pour: CupSoda,
  wait: Hourglass,
  cut: Scissors,
  wrap: Package,
  fill: Milk,
  qc: ClipboardCheck,
  move: Truck,
  other: Wrench,
};

/** The picture of a step block (ADR-086), in a soft round badge. */
export function BlockIcon({ block, className, size = 20 }: { block: string; className?: string; size?: number }) {
  const I = ICONS[block] ?? Wrench;
  return (
    <span aria-hidden className={cx("inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary-text", className)}>
      <I size={size} />
    </span>
  );
}
