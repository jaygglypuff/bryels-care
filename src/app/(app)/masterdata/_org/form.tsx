"use client";
import { createContext, useActionState, useContext, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, LinkButton, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";

/**
 * Small form kit for the W2G master data screens: one server action per form, field errors from
 * the service (DomainError → ActionState.fieldErrors) shown under the matching field, a pending
 * submit button and the result message. No client-side business rules.
 */
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const Errors = createContext<Record<string, string>>({});
const useErr = (name: string) => useContext(Errors)[name];

export function ActionForm({
  action,
  submitLabel,
  pendingText = "Saving…",
  hidden = {},
  cancelHref,
  variant = "primary",
  children,
  className,
}: {
  action: Action;
  submitLabel: string;
  pendingText?: string;
  hidden?: Record<string, string>;
  cancelHref?: string;
  variant?: "primary" | "cta" | "secondary" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className={cx("space-y-4", className)} noValidate>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Errors.Provider value={state?.fieldErrors ?? {}}>{children}</Errors.Provider>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant={variant} pendingText={pendingText}>
          {submitLabel}
        </SubmitButton>
        {cancelHref && (
          <LinkButton href={cancelHref} variant="secondary">
            Cancel
          </LinkButton>
        )}
      </div>
    </form>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function TextField({
  name,
  label,
  defaultValue,
  hint,
  placeholder,
  mono,
  inputMode,
  readOnly,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  hint?: string;
  placeholder?: string;
  mono?: boolean;
  inputMode?: "numeric" | "decimal" | "text";
  readOnly?: boolean;
  type?: "text" | "date" | "email" | "tel";
}) {
  const error = useErr(name);
  return (
    <Field label={label} htmlFor={`f-${name}`} error={error} hint={hint}>
      <Input
        id={`f-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        inputMode={inputMode}
        readOnly={readOnly}
        autoComplete="off"
        aria-invalid={!!error}
        className={cx(mono && "font-mono", readOnly && "bg-surface-2 text-muted")}
      />
    </Field>
  );
}

export function TextareaField({ name, label, defaultValue, hint, placeholder }: { name: string; label: string; defaultValue?: string | null; hint?: string; placeholder?: string }) {
  const error = useErr(name);
  return (
    <Field label={label} htmlFor={`f-${name}`} error={error} hint={hint}>
      <Textarea id={`f-${name}`} name={name} defaultValue={defaultValue ?? ""} placeholder={placeholder} aria-invalid={!!error} />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  hint,
  emptyLabel,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  hint?: string;
  emptyLabel?: string;
}) {
  const error = useErr(name);
  return (
    <Field label={label} htmlFor={`f-${name}`} error={error} hint={hint}>
      <Select id={`f-${name}`} name={name} defaultValue={defaultValue ?? ""} aria-invalid={!!error}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Checkbox that always submits a value ("false" when unchecked), so defaults never flip silently. */
export function CheckField({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  const error = useErr(name);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
        <input type="hidden" name={name} value="false" />
        <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="size-5 accent-[var(--color-primary,#2e7d32)]" />
        {label}
      </label>
      {hint && !error && <p className="text-[12px] text-muted">{hint}</p>}
      {error && <p className="text-[12px] text-[var(--bad-fg)]">{error}</p>}
    </div>
  );
}

/**
 * Big choice buttons (ADR-088): a radio group that looks like large tappable cards, one per option,
 * with a plain explanation under each. Uncontrolled with `defaultValue`, or controlled with
 * `value` + `onChange` when other boxes follow the choice.
 */
export function ChoiceField({
  name,
  label,
  options,
  defaultValue,
  value,
  onChange,
  columns = 3,
}: {
  name: string;
  label: string;
  options: { value: string; label: string; help?: string }[];
  defaultValue?: string | null;
  value?: string;
  onChange?: (v: string) => void;
  columns?: 2 | 3;
}) {
  const error = useErr(name);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-[15px] font-semibold text-fg">{label}</legend>
      <div className={cx("grid grid-cols-1 gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[14px] border border-line-strong bg-surface p-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:checked]:bg-[var(--brand-50)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--lime-200)]"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value })}
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary,#2e7d32)]"
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-fg">{o.label}</span>
              {o.help && <span className="block text-[13px] text-fg-2">{o.help}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="text-[12px] text-[var(--bad-fg)]">{error}</p>}
    </fieldset>
  );
}

export function MultiCheckField({ name, label, options, defaultValues = [], hint }: { name: string; label: string; options: { value: string; label: string }[]; defaultValues?: string[]; hint?: string }) {
  const error = useErr(name);
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-medium text-fg">{label}</legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-[36px] items-center gap-2 text-[13px]">
            <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="size-4" />
            {o.label}
          </label>
        ))}
      </div>
      {hint && !error && <p className="text-[12px] text-muted">{hint}</p>}
      {error && <p className="text-[12px] text-[var(--bad-fg)]">{error}</p>}
    </fieldset>
  );
}
