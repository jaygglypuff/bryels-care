import type { ReactNode } from "react";
import { cx } from "./core";

/**
 * One titled group of fields in a long form on a record or setup page (harmony leftovers, ADR-123;
 * docs/ux-system.md Rules: 5.8 "Long forms"). Server-safe (no hooks), so client forms can use it too.
 *
 * Anatomy: a `fieldset` whose `legend` is the section title in the `text-section` role (the same size as a card
 * title), an optional one-line hint (`text-meta`), then the fields (gap 16, ADR-119 8 px grid). Fields people rarely
 * need go in `more`: they fold under a `details` named `moreTitle` (default "More (you can skip this)"), so a section
 * never shows more than five fields until it is opened (round 4 rule, ADR-088). `open` opens the fold, for example
 * when one of the folded fields already holds a value the person should see.
 *
 * Rules for callers: every visible field keeps its own `label`; the title is a noun phrase in grade-5 words
 * ("Name and kind", "How to store it"), never a code. A form of five fields or fewer needs no section.
 */
export function FormSection({
  title,
  hint,
  children,
  more,
  moreTitle = "More (you can skip this)",
  open = false,
  className,
  testId,
}: {
  title: string;
  hint?: ReactNode;
  /** At most five visible fields. */
  children?: ReactNode;
  /** Fields folded under `moreTitle`. */
  more?: ReactNode;
  moreTitle?: string;
  open?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <fieldset className={cx("min-w-0 border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0", className)} data-testid={testId ?? "form-section"}>
      <legend className="float-left mb-1 w-full text-section font-semibold text-fg sm:text-section-lg">{title}</legend>
      {hint && <p className="clear-both mb-1 text-meta text-muted">{hint}</p>}
      <div className="clear-both flex flex-col gap-4 pt-2">
        {children}
        {more && (
          <details className="rounded-[12px] border border-line bg-surface-2/40 px-4 py-0.5" open={open}>
            <summary className="flex min-h-[44px] cursor-pointer items-center py-2 text-[14px] font-medium text-fg-2">{moreTitle}</summary>
            <div className="flex flex-col gap-4 pb-3 pt-1">{more}</div>
          </details>
        )}
      </div>
    </fieldset>
  );
}

/**
 * The edit form of a setup record, folded (ADR-123). On a setup page the "What to do next" box holds the page's one
 * green button; the form's Save would be a second one, so the form sits closed under "Change the details" (the
 * section title role) until someone opens it. `open` keeps it open (for example when nothing else on the page acts).
 * The read-only facts stay on the page; this only folds the form. Same form, same server action.
 */
export function EditDetails({ title = "Change the details", hint, open = false, id = "edit", children }: { title?: string; hint?: ReactNode; open?: boolean; id?: string; children: ReactNode }) {
  return (
    <details id={id} className="group rounded-[16px] bg-surface p-4 shadow-[var(--shadow-card)] sm:rounded-[20px] sm:p-6" open={open} data-testid="edit-details">
      <summary className="-m-2 flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-[12px] p-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className="text-section font-semibold text-fg sm:text-section-lg">{title}</span>
        <span className="text-meta font-medium text-primary-text group-open:hidden">Open</span>
        <span className="hidden text-meta font-medium text-muted group-open:inline">Close</span>
      </summary>
      {hint && <p className="mt-1 text-meta text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </details>
  );
}
