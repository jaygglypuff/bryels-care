"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { BASE_UOMS, MATERIAL_KINDS, createMaterial } from "@/modules/inventory/masterdata";

const MaterialSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/, { message: "Use capital letters, digits, dot, dash or underscore, e.g. MAT-0070." }),
  name: z.string().trim().min(2, { message: "Enter the material name." }).max(200),
  inciName: z.string().trim().max(300).optional(),
  materialKind: z.enum(MATERIAL_KINDS, { message: "Choose a kind." }),
  baseUom: z.enum(BASE_UOMS, { message: "Choose a base unit." }),
  shelfLifeDays: z.union([z.literal(""), z.coerce.number().int({ message: "Whole days only." }).min(1, { message: "At least 1 day." }).max(3650)]).optional(),
  storageConditions: z.string().trim().max(300).optional(),
});

export async function createMaterialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    const ctx = await requireContext();
    const d = MaterialSchema.parse(Object.fromEntries(formData));
    const m = await createMaterial(ctx, { ...d, shelfLifeDays: d.shelfLifeDays === "" || d.shelfLifeDays === undefined ? null : d.shelfLifeDays });
    code = m.code;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/materials");
  redirect(`/masterdata/materials?created=${encodeURIComponent(code)}`);
}
