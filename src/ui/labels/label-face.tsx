"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LabelFaceData } from "@/modules/documents";
import { cx } from "../core";

/**
 * The one label component (ADR-099), used by the preview on task screens AND by the print pages, so what
 * the screen shows is what the printer gets: the label renderer's markup and stylesheet (sizes in mm), scoped
 * by label size. On a narrow phone the screen copy is scaled down to fit (never on paper). On screen only
 * the first copy is shown; on paper every copy prints, one label per page, each size on its own page size.
 */
const BASE_CSS = `
.lf-face { max-width: 100%; }
.lf-face .lbl-sheet { padding: 0; align-items: flex-start; }
@media screen {
  .lf-first .lbl ~ .lbl { display: none; }
  .lf-fit { zoom: var(--lf-zoom, 1); }
  .lf-face .lbl { box-shadow: 0 1px 3px rgba(0,0,0,.18); }
}
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .lf-noprint { display: none !important; }
  .lf-sheet { display: block !important; gap: 0 !important; margin: 0 !important; padding: 0 !important; }
  /* Whatever page wraps the sheet: no margins or padding on paper, or the label is pushed off its page. */
  body *:has(.lf-sheet) { margin: 0 !important; padding: 0 !important; max-width: none !important; min-height: 0 !important; gap: 0 !important; }
  .lf-sheet > div { display: contents !important; }
  .lf-face, .lf-fit { zoom: 1 !important; max-width: none; }
  .lf-face .lbl-sheet { display: block; padding: 0; gap: 0; }
  .lf-face .lbl { display: grid !important; border: none; border-radius: 0; box-shadow: none; margin: 0; break-after: page; page-break-after: always; }
  .lf-sheet > :last-child .lbl:last-child { break-after: auto; page-break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

const PX_PER_MM = 96 / 25.4;

export function LabelFace({ face, show = "first", printable = false, fit = true, className }: { face: LabelFaceData; show?: "first" | "all"; printable?: boolean; fit?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!fit || !el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
      const need = face.widthMm * PX_PER_MM + 4;
      setZoom(avail > 0 && avail < need ? Math.max(0.3, Math.floor((avail / need) * 100) / 100) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, face.widthMm]);
  return (
    <div
      ref={ref}
      className={cx("lf-face", face.sizeKey, show === "first" && "lf-first", !printable && "lf-noprint", className)}
      style={{ ["--lf-zoom" as string]: String(zoom) }}
      data-testid="label-face"
      data-payload={face.payload}
      data-size={`${face.widthMm}x${face.heightMm}`}
    >
      <style>{face.css + BASE_CSS}</style>
      <div className="lf-fit" dangerouslySetInnerHTML={{ __html: face.body }} />
    </div>
  );
}

/**
 * A print page's labels: every face (all copies) in one sheet. When all labels have one size the default
 * page gets that size too (browsers without named pages); mixed sizes use the named page of each size.
 */
export function LabelSheet({ faces, captions, screen = "first" }: { faces: LabelFaceData[]; captions?: ReactNode[]; screen?: "first" | "all" }) {
  const sizes = [...new Set(faces.map((f) => `${f.widthMm}mm ${f.heightMm}mm`))];
  return (
    <div className="lf-sheet flex flex-col items-center gap-6" data-testid="label-sheet">
      {sizes.length === 1 && <style>{`@page { size: ${sizes[0]}; margin: 0; }`}</style>}
      {faces.map((f, i) => (
        <div key={i} className="grid w-full max-w-full justify-items-center gap-2">
          {captions?.[i] ? <div className="no-print w-full max-w-[640px] text-[15px] text-fg-2">{captions[i]}</div> : null}
          <LabelFace face={f} show={screen} printable />
        </div>
      ))}
    </div>
  );
}
