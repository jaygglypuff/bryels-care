"use server";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { activateDevice, changeDeviceStatus } from "@/lib/offline/server/devices";

/** US-7-06: activate (or change the offline grants of) a device; `platform.device.admin` at its site. */
export async function activateDeviceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const r = await activateDevice(ctx, {
      deviceId: String(fd.get("deviceId") ?? ""),
      workflows: fd.getAll("workflows").map(String),
      label: (fd.get("label") as string | null) ?? null,
      deviceClass: (fd.get("deviceClass") as string | null) ?? null,
      isManaged: fd.get("isManaged") === "on",
    });
    refreshCurrentPage();
    return { ok: true, message: r.status === "active" ? "Saved. The device picks up the change at its next sync." : "Saved." };
  } catch (e) {
    return toActionState(e);
  }
}

/** Suspend (reversible) or remove (final) a device with a reason. */
export async function changeDeviceStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const to = String(fd.get("to") ?? "") === "removed" ? "removed" : "suspended";
    await changeDeviceStatus(ctx, { deviceId: String(fd.get("deviceId") ?? ""), to, reason: String(fd.get("reason") ?? "") });
    refreshCurrentPage();
    return { ok: true, message: to === "removed" ? "Removed. The device clears its offline data the next time it opens." : "Suspended. Offline work from it is refused until reactivated." };
  } catch (e) {
    return toActionState(e);
  }
}
