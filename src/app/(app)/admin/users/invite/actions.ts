"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { inviteUser } from "@/modules/identity";

export type InviteState = (NonNullable<ActionState> & { userId?: string; manualLink?: string | null; emailed?: boolean }) | null;

export async function invite(_: InviteState, fd: FormData): Promise<InviteState> {
  const ctx = await requireContext();
  try {
    const siteRaw = String(fd.get("siteId") ?? "");
    const r = await inviteUser(ctx, {
      email: String(fd.get("email") ?? ""),
      displayName: String(fd.get("displayName") ?? ""),
      grants: [
        {
          roleId: String(fd.get("roleId") ?? ""),
          siteId: siteRaw === "org" ? null : siteRaw,
          warehouseIds: fd.getAll("warehouseIds").filter((x): x is string => typeof x === "string" && !!x),
        },
      ],
    });
    revalidatePath("/admin/users");
    return {
      ok: true,
      userId: r.userId,
      manualLink: r.delivery.manualLink,
      emailed: r.delivery.status === "sent",
      message: r.delivery.status === "sent" ? "Invitation emailed. The link works once, for 72 hours." : "Invitation created.",
    };
  } catch (e) {
    const s = toActionState(e);
    if (s?.fieldErrors?.["grants.0.roleId"] || s?.fieldErrors?.grants) s.fieldErrors.roleId = s.fieldErrors["grants.0.roleId"] ?? s.fieldErrors.grants;
    return s;
  }
}
