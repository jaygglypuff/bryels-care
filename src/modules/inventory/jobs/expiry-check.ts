import "server-only";
import { z } from "zod";
import { runExpiryCheck, runExpiryCheckAll } from "../holds-expiry";

/**
 * Job handler for the nightly expiry check (US-2-10; job registry in docs/architecture.md §8).
 * The W1A job registry wires `{ code, handler }`; suggested schedule: daily 00:15 Asia/Manila.
 * Payload (validated): { organizationId?, asOf? (YYYY-MM-DD), onBehalfOf? (user id for on-demand runs) }.
 */
export const payloadSchema = z
  .object({
    organizationId: z.uuid().optional(),
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    onBehalfOf: z.uuid().nullable().optional(),
  })
  .strict();

export type ExpiryCheckPayload = z.infer<typeof payloadSchema>;

export async function handler(payload: unknown = {}) {
  const p = payloadSchema.parse(payload ?? {});
  if (p.organizationId) return [{ organizationId: p.organizationId, ...(await runExpiryCheck({ organizationId: p.organizationId, asOf: p.asOf, onBehalfOf: p.onBehalfOf ?? null })) }];
  return runExpiryCheckAll({ asOf: p.asOf, onBehalfOf: p.onBehalfOf ?? null });
}

export const expiryCheckJob = { code: "inventory.expiry_check", handler, payloadSchema } as const;
export const code = expiryCheckJob.code;
export default expiryCheckJob;
