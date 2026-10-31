import type { LabelFaceData, LabelKind } from "@/modules/documents";
import { cx } from "../core";
import { LabelFace } from "./label-face";
import { LABEL_KIND_WORDS, SCAN_SENTENCE } from "./words";

/**
 * "Which label?" (ADR-099): the label exactly as it will print (true size; scaled down only to fit a phone),
 * with one sentence saying where it goes ("Stick one on each sack or drum.") and what the code does.
 * Works in server and client components. `data` is one option of `labelPreview()` (or any LabelFaceData).
 *
 *   <LabelPreview kind="sack" data={preview.options[0].face} />
 *   <LabelPreview kind="bar" data={face} size="small" />   // small: a thumbnail next to a step
 */
export function LabelPreview({ kind, data, size = "full", sentence, className }: { kind: LabelKind; data: LabelFaceData; size?: "full" | "small"; sentence?: string; className?: string }) {
  const w = LABEL_KIND_WORDS[kind];
  return (
    <figure className={cx("m-0 grid gap-2", className)} data-testid="label-preview" data-kind={kind}>
      <div className={cx("overflow-hidden rounded-[14px] bg-surface-2 p-3", size === "small" && "max-w-[240px]")}>
        <LabelFace face={data} />
      </div>
      <figcaption className="text-[16px] font-medium text-fg">
        {sentence ?? w.stick}{" "}
        <span className="block text-[14px] font-normal text-fg-2">
          Real size {data.widthMm} × {data.heightMm} mm. {w.scan || SCAN_SENTENCE}
        </span>
      </figcaption>
    </figure>
  );
}
