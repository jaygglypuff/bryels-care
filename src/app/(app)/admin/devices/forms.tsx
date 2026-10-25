"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { activateDeviceAction, changeDeviceStatusAction } from "./actions";

type Device = { id: string; label: string; status: "pending" | "active" | "suspended" | "removed"; deviceClass: string; isManaged: boolean; workflows: string[] };

/** Approve / change grants, suspend and remove (US-7-06). The server checks `platform.device.admin` at the device's site. */
export function DeviceForms({ device, workflows }: { device: Device; workflows: { code: string; label: string }[] }) {
  const approve = device.status === "pending" ? "Approve device" : device.status === "suspended" ? "Reactivate" : "Save offline workflows";
  return (
    <div className="mt-2 flex flex-wrap gap-4">
      <details className="w-full sm:w-auto" open={device.status === "pending"}>
        <summary className="cursor-pointer text-[13px] font-medium text-primary-text">{approve}</summary>
        <div className="mt-2 sm:w-80">
          <ActionForm action={activateDeviceAction} hidden={{ deviceId: device.id }} submit={approve}>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[13px] font-medium">Offline workflows on this device</legend>
              {workflows.map((w) => (
                <label key={w.code} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                  <input type="checkbox" name="workflows" value={w.code} defaultChecked={device.status === "pending" ? w.code !== "movement_request" : device.workflows.includes(w.code)} className="size-5" />
                  {w.label}
                </label>
              ))}
            </fieldset>
            <Field label="Device name" htmlFor={`label-${device.id}`}>
              <Input id={`label-${device.id}`} name="label" defaultValue={device.label} maxLength={80} />
            </Field>
            <Field label="Kind of device" htmlFor={`class-${device.id}`}>
              <Select id={`class-${device.id}`} name="deviceClass" defaultValue={device.deviceClass}>
                <option value="floor_shared">Shared floor device</option>
                <option value="personal">Personal phone</option>
                <option value="managed_tablet">Managed tablet</option>
              </Select>
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
              <input type="checkbox" name="isManaged" defaultChecked={device.isManaged} className="size-5" /> Managed by IT (MDM)
            </label>
          </ActionForm>
        </div>
      </details>
      {device.status === "active" && (
        <details className="w-full sm:w-auto">
          <summary className="cursor-pointer text-[13px] font-medium text-primary-text">Suspend</summary>
          <div className="mt-2 sm:w-72">
            <ActionForm action={changeDeviceStatusAction} hidden={{ deviceId: device.id, to: "suspended" }} submit="Suspend device" variant="secondary">
              {(fe) => (
                <Field label="Reason" htmlFor={`susp-${device.id}`} error={fe.reason}>
                  <Textarea id={`susp-${device.id}`} name="reason" required minLength={5} placeholder="e.g. screen cracked, sent for repair" />
                </Field>
              )}
            </ActionForm>
          </div>
        </details>
      )}
      <details className="w-full sm:w-auto">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--bad-fg)]">Remove</summary>
        <div className="mt-2 sm:w-72">
          <ActionForm action={changeDeviceStatusAction} hidden={{ deviceId: device.id, to: "removed" }} submit="Remove device" variant="danger" confirm={`Remove ${device.label}? Its offline data is cleared the next time it opens, and it must be registered again.`}>
            {(fe) => (
              <Field label="Reason" htmlFor={`rm-${device.id}`} error={fe.reason}>
                <Textarea id={`rm-${device.id}`} name="reason" required minLength={5} placeholder="e.g. phone lost, replaced" />
              </Field>
            )}
          </ActionForm>
        </div>
      </details>
    </div>
  );
}
