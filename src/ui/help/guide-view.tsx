import type { ReactNode } from "react";
import type { Guide } from "./guides";

/** `**bold**` → <strong>; everything else is text (no HTML is ever interpreted). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

/** Renders a parsed guide; `step` highlights the section the user is on. */
export function GuideView({ guide, step }: { guide: Guide; step?: string | null }) {
  return (
    <div className="space-y-3 text-[14px] leading-relaxed">
      {guide.blocks.map((b, i) => {
        if (b.kind === "h")
          return (
            <h3 key={i} id={`guide-${b.id}`} className={`pt-1 text-[15px] font-semibold ${step && b.id === step ? "rounded-[8px] bg-primary-soft px-2" : ""}`}>
              {b.text}
            </h3>
          );
        if (b.kind === "p") return <p key={i}>{inline(b.text)}</p>;
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
        return b.kind === "ol" ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        );
      })}
    </div>
  );
}
