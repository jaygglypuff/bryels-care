"use client";
import { Button } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { allocateAction } from "../actions";
import { useActionForm } from "../use-action-form";

export function AllocateForm({ orderId, label = "Set aside the stock" }: { orderId: string; label?: string }) {
  const { state, pending, onSubmit } = useActionForm(allocateAction.bind(null, orderId));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Setting aside…" : label}
      </Button>
    </form>
  );
}
