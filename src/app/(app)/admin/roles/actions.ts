"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { cloneRole, deactivateCustomRole, deleteCustomRole, updateCustomRole } from "@/modules/identity";

const perms = (fd: FormData) => fd.getAll("permissions").filter((x): x is string => typeof x === "string");

export async function cloneRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let id: string;
  try {
    id = await cloneRole(ctx, {
      sourceRoleId: String(fd.get("sourceRoleId") ?? ""),
      code: String(fd.get("code") ?? ""),
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? "") || null,
      permissions: perms(fd),
    });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/admin/roles");
  redirect(`/admin/roles/${id}?created=1`);
}

export async function updateRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const id = String(fd.get("roleId") ?? "");
  try {
    await updateCustomRole(ctx, id, { name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? "") || null, permissions: perms(fd), reason: String(fd.get("reason") ?? "") });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath(`/admin/roles/${id}`);
  return { ok: true, message: "Role saved. People holding it get the change on their next request." };
}

export async function deactivateRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const id = String(fd.get("roleId") ?? "");
  try {
    const n = await deactivateCustomRole(ctx, id, String(fd.get("reason") ?? ""));
    revalidatePath(`/admin/roles/${id}`);
    return { ok: true, message: `Role deactivated; ${n} assignment(s) ended.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function deleteRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await deleteCustomRole(ctx, String(fd.get("roleId") ?? ""));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/admin/roles");
  redirect("/admin/roles?deleted=1");
}
