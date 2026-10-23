"use client";
import { useActionState } from "react";
import { Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { recordTestResultAction } from "../../actions";

/** Append-only QC result entry. Specifications are typed by QA from the company's approved specification. */
export function TestResultForm({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(recordTestResultAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="batchId" value={batchId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Test name" htmlFor="testName" error={fe.testName}>
          <Input id="testName" name="testName" required maxLength={120} placeholder="For example: Appearance" />
        </Field>
        <Field label="Specification" htmlFor="specification" error={fe.specification} hint="As written in the approved specification.">
          <Input id="specification" name="specification" required maxLength={200} placeholder="For example: Smooth bar, no cracks" />
        </Field>
        <Field label="Result" htmlFor="result" error={fe.result}>
          <Input id="result" name="result" required maxLength={200} placeholder="For example: Conforms" />
        </Field>
        <Field label="Outcome" htmlFor="passed" error={fe.passed}>
          <Select id="passed" name="passed" required defaultValue="">
            <option value="" disabled>
              Choose pass or fail
            </option>
            <option value="pass">Pass (within specification)</option>
            <option value="fail">Fail (out of specification)</option>
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingText="Recording…">
          Record test result
        </SubmitButton>
      </div>
    </form>
  );
}
