"use server";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { addLookupValue, deleteLookupValue, moveLookupValue, renameLookupValue, setLookupValueActive } from "@/modules/masterdata";

/** Master data → Lists (ADR-076): thin in-place adapters (ADR-043); the service validates and authorizes. */
type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function run(fn: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<unknown>, message: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await fn(ctx);
  } catch (e) {
    return toActionState(e);
  }
  refreshCurrentPage();
  return { ok: true, message };
}

export const addLookupValueAction: A = async (_p, fd) => run((ctx) => addLookupValue(ctx, { listKey: f(fd, "listKey"), label: f(fd, "label") }), `Added "${f(fd, "label").trim()}".`);
export const renameLookupValueAction: A = async (_p, fd) => run((ctx) => renameLookupValue(ctx, { listKey: f(fd, "listKey"), code: f(fd, "code"), label: f(fd, "label") }), "Name saved.");
export const moveLookupValueAction: A = async (_p, fd) =>
  run((ctx) => moveLookupValue(ctx, { listKey: f(fd, "listKey"), code: f(fd, "code"), direction: f(fd, "direction") === "up" ? "up" : "down" }), "Order saved.");
export const setLookupValueActiveAction: A = async (_p, fd) =>
  run((ctx) => setLookupValueActive(ctx, { listKey: f(fd, "listKey"), code: f(fd, "code"), active: f(fd, "active") === "true" }), f(fd, "active") === "true" ? "Turned on: it is offered again." : "Turned off: no longer offered.");
export const deleteLookupValueAction: A = async (_p, fd) => run((ctx) => deleteLookupValue(ctx, { listKey: f(fd, "listKey"), code: f(fd, "code") }), "Deleted.");
