"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { allocateAction, cancelOrderAction, confirmOrderAction, dispatchAction, recordDeliveryAction } from "../actions";
import { useActionForm } from "../use-action-form";

export function ConfirmOrderForm({ orderId }: { orderId: string }) {
  const { state, pending, onSubmit } = useActionForm(confirmOrderAction.bind(null, orderId));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Confirming…" : "Confirm order"}
      </Button>
    </form>
  );
}

export function CancelOrderForm({ orderId, hasAllocations }: { orderId: string; hasAllocations: boolean }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(
    cancelOrderAction.bind(null, orderId),
    "Cancel this order? This cannot be undone." + (hasAllocations ? " Its allocated stock will be released." : ""),
  );
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Cancel order
      </Button>
    );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[12px] border border-line p-3">
      <Field label="Reason for cancelling" htmlFor="reason" error={state?.fieldErrors?.reason}>
        <Input id="reason" name="reason" maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer withdrew the PO" />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel order"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Keep order
        </Button>
      </div>
    </form>
  );
}

export function AllocateForm({ orderId, label = "Allocate stock (FEFO)" }: { orderId: string; label?: string }) {
  const { state, pending, onSubmit } = useActionForm(allocateAction.bind(null, orderId));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Allocating…" : label}
      </Button>
    </form>
  );
}

export function DispatchForm({ orderId, suggestedPackages }: { orderId: string; suggestedPackages: number }) {
  const { state, pending, onSubmit } = useActionForm(
    dispatchAction.bind(null, orderId),
    "Dispatch now? This issues the allocated stock and cannot be undone without a return.",
  );
  const fe = state?.fieldErrors ?? {};
  const [v, setV] = useState({ carrier: "Own truck", driverName: "", vehiclePlate: "", packageCount: String(suggestedPackages) });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Carrier" htmlFor="carrier" error={fe.carrier}>
          <Input id="carrier" name="carrier" value={v.carrier} onChange={(e) => setV({ ...v, carrier: e.target.value })} required maxLength={80} />
        </Field>
        <Field label="Driver" htmlFor="driverName" error={fe.driverName}>
          <Input id="driverName" name="driverName" value={v.driverName} onChange={(e) => setV({ ...v, driverName: e.target.value })} required maxLength={80} />
        </Field>
        <Field label="Vehicle plate" htmlFor="vehiclePlate" error={fe.vehiclePlate}>
          <Input id="vehiclePlate" name="vehiclePlate" value={v.vehiclePlate} onChange={(e) => setV({ ...v, vehiclePlate: e.target.value })} required maxLength={20} autoCapitalize="characters" />
        </Field>
        <Field label="Package count" htmlFor="packageCount" error={fe.packageCount} hint="Boxes / cartons loaded">
          <Input id="packageCount" name="packageCount" inputMode="numeric" value={v.packageCount} onChange={(e) => setV({ ...v, packageCount: e.target.value })} required />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Posting dispatch…" : "Dispatch"}
      </Button>
    </form>
  );
}

export function DeliveryForm({ shipmentId, orderId, now }: { shipmentId: string; orderId: string; now: string }) {
  const { state, pending, onSubmit } = useActionForm(recordDeliveryAction.bind(null, shipmentId, orderId));
  const fe = state?.fieldErrors ?? {};
  const [v, setV] = useState({ receivedByName: "", deliveredAt: now });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Received by (name)" htmlFor="receivedByName" error={fe.receivedByName}>
          <Input id="receivedByName" name="receivedByName" value={v.receivedByName} onChange={(e) => setV({ ...v, receivedByName: e.target.value })} required maxLength={80} />
        </Field>
        <Field label="Delivered at" htmlFor="deliveredAt" error={fe.deliveredAt} hint="Philippine time">
          <Input id="deliveredAt" name="deliveredAt" type="datetime-local" max={now} value={v.deliveredAt} onChange={(e) => setV({ ...v, deliveredAt: e.target.value })} required />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Record delivery"}
      </Button>
    </form>
  );
}
