"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  AddressSchema,
  ArtworkSchema,
  ContactSchema,
  CreditTermsSchema,
  CustomerCreateSchema,
  CustomerProfileSchema,
  RequirementSchema,
  addAddress,
  addContact,
  approveRequirement,
  createArtworkVersion,
  createCustomer,
  draftRequirement,
  issuesToFieldErrors,
  makePrimaryContact,
  rejectRequirement,
  removeAddress,
  removeContact,
  retireRequirement,
  setCreditTerms,
  setCustomerStatus,
  setDefaultAddress,
  setItemCode,
  submitRequirement,
  updateCustomer,
} from "@/modules/sales";

/** Customer master and requirement actions (US-4-01, US-4-02): parse, call the service, refresh in place (ADR-043). */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const obj = (fd: FormData, keys: string[], prefix = "") => Object.fromEntries(keys.map((k) => [k, str(fd, prefix + k)]));
const uuid = z.string().uuid("Choose a valid option.");
const ADDRESS_KEYS = ["label", "line1", "line2", "city", "province", "postalCode", "country", "contactName", "phone"];
const invalid = (issues: { path: PropertyKey[]; message: string }[], prefix = ""): ActionState => {
  const fe = issuesToFieldErrors(issues);
  return { ok: false, message: "Check the highlighted fields.", fieldErrors: prefix ? Object.fromEntries(Object.entries(fe).map(([k, v]) => [prefix + k, v])) : fe };
};
const done = (message: string): ActionState => {
  refreshCurrentPage();
  return { ok: true, message };
};

export async function createCustomerW3dAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const parsed = CustomerCreateSchema.safeParse({
      ...obj(fd, ["code", "name", "status", "segment", "contactName", "phone", "email", "minShelfLifeDays", "defaultLeadTimeDays", "notesInternal", "paymentTermsDays"]),
      shipTo: obj(fd, ADDRESS_KEYS, "shipTo."),
    });
    if (!parsed.success) return invalid(parsed.error.issues);
    id = (await createCustomer(ctx, { ...parsed.data, idempotencyKey: str(fd, "idempotencyKey") || null })).id;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/customers");
  redirect(`/sales/customers/${id}?created=1`);
}

export async function updateCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const parsed = CustomerProfileSchema.safeParse(obj(fd, ["name", "segment", "minShelfLifeDays", "defaultLeadTimeDays", "notesInternal"]));
    if (!parsed.success) return invalid(parsed.error.issues);
    await updateCustomer(ctx, uuid.parse(str(fd, "customerId")), parsed.data);
    return done("Profile saved.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function creditTermsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const parsed = CreditTermsSchema.safeParse(obj(fd, ["creditLimitAmount", "paymentTermsDays", "taxIdentifier", "reason"]));
    if (!parsed.success) return invalid(parsed.error.issues);
    await setCreditTerms(ctx, uuid.parse(str(fd, "customerId")), parsed.data);
    return done("Credit terms saved and recorded in the audit log.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function customerStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const to = z.enum(["prospect", "active", "on_hold", "inactive"]).parse(str(fd, "to"));
    await setCustomerStatus(ctx, uuid.parse(str(fd, "customerId")), to, str(fd, "reason") ?? "");
    return done(to === "on_hold" ? "Credit hold placed: new orders of this customer will need approval." : "Status changed.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function addAddressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const parsed = AddressSchema.safeParse(obj(fd, ADDRESS_KEYS));
    if (!parsed.success) return invalid(parsed.error.issues);
    await addAddress(ctx, uuid.parse(str(fd, "customerId")), { ...parsed.data, makeDefaultShipTo: str(fd, "makeDefaultShipTo") === "on", makeDefaultBillTo: str(fd, "makeDefaultBillTo") === "on" });
    return done("Address added.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function addressCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "addressId"));
    const cmd = z.enum(["default_ship_to", "default_bill_to", "remove"]).parse(str(fd, "command"));
    if (cmd === "remove") await removeAddress(ctx, id);
    else await setDefaultAddress(ctx, id, cmd === "default_ship_to" ? "ship_to" : "bill_to");
    return done(cmd === "remove" ? "Address removed." : "Default address changed.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function addContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const parsed = ContactSchema.safeParse(obj(fd, ["name", "email", "phone", "roleLabel", "isPrimary"]));
    if (!parsed.success) return invalid(parsed.error.issues);
    await addContact(ctx, uuid.parse(str(fd, "customerId")), parsed.data);
    return done("Contact added.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function contactCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "contactId"));
    const cmd = z.enum(["primary", "remove"]).parse(str(fd, "command"));
    if (cmd === "remove") await removeContact(ctx, id);
    else await makePrimaryContact(ctx, id);
    return done(cmd === "remove" ? "Contact removed." : "Primary contact changed.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function draftRequirementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const parsed = RequirementSchema.safeParse(obj(fd, ["customerId", "productId", "requirementKind", "valueNumeric", "valueText", "artworkVersionId", "effectiveFrom", "changeSummary"]));
    if (!parsed.success) return invalid(parsed.error.issues);
    const r = await draftRequirement(ctx, parsed.data);
    if (str(fd, "submitNow") === "on") await submitRequirement(ctx, r.id);
    return done(str(fd, "submitNow") === "on" ? `Version ${r.versionNo} drafted and sent for approval.` : `Version ${r.versionNo} saved as a draft.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function requirementCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "requirementId"));
    const cmd = z.enum(["submit", "approve", "return", "reject", "retire"]).parse(str(fd, "command"));
    const reason = str(fd, "reason") ?? "";
    if (cmd === "submit") await submitRequirement(ctx, id);
    else if (cmd === "approve") await approveRequirement(ctx, id, str(fd, "note") || null);
    else if (cmd === "retire") await retireRequirement(ctx, id, reason);
    else await rejectRequirement(ctx, id, reason, { returnToDraft: cmd === "return" });
    return done({ submit: "Sent for approval.", approve: "Approved: it applies from its effective date.", return: "Returned to draft.", reject: "Rejected.", retire: "Retired: it no longer applies to new orders." }[cmd]);
  } catch (e) {
    return toActionState(e);
  }
}

export async function createArtworkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const parsed = ArtworkSchema.safeParse(obj(fd, ["customerId", "productId", "artworkCode", "versionLabel", "description"]));
    if (!parsed.success) return invalid(parsed.error.issues);
    const a = await createArtworkVersion(ctx, parsed.data);
    return done(`Artwork ${a.artworkCode} ${a.versionLabel} registered. Reference it in a label artwork requirement.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function itemCodeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await setItemCode(ctx, { customerId: uuid.parse(str(fd, "customerId")), productId: uuid.parse(str(fd, "productId")), customerItemCode: str(fd, "customerItemCode") ?? "", customerDescription: str(fd, "customerDescription") || null });
    return done("Customer item code saved.");
  } catch (e) {
    return toActionState(e);
  }
}
