"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { createSupplier, updateSupplier, type SupplierInput } from "@/modules/masterdata";

function input(fd: FormData): SupplierInput {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    code: s("code"),
    name: s("name"),
    contactName: s("contactName"),
    email: s("email"),
    phone: s("phone"),
    addressLine1: s("addressLine1"),
    city: s("city"),
    country: s("country"),
    paymentTermsDays: s("paymentTermsDays"),
    defaultLeadTimeDays: s("defaultLeadTimeDays"),
    qualityStatus: s("qualityStatus") as SupplierInput["qualityStatus"],
    qualityStatusReason: s("qualityStatusReason"),
    isActive: fd.get("isActive") === "on",
    notes: s("notes"),
  };
}

export async function saveSupplierAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("supplierId") ?? "");
  let target: string;
  try {
    const ctx = await requireContext();
    const s = id ? await updateSupplier(ctx, id, input(fd)) : await createSupplier(ctx, input(fd));
    target = `/masterdata/suppliers/${s.id}?saved=1`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/suppliers");
  redirect(target);
}
