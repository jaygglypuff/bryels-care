import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The form's idempotency key, or a fresh one when the form had none yet (ADR-132 §10, completing ADR-125 item 5).
 * Forms make their key after hydration (`useClientKey`), so a form sent in the instant before that carries no key.
 * Such a send is treated as "no key": it gets its own key here and saves once, like the actions that take an optional
 * key. A key that is there is passed on unchanged (a retry of the same form still replays). Server side only.
 */
export function formKey(fd: FormData, name = "idempotencyKey"): string {
  const v = String(fd.get(name) ?? "").trim();
  return UUID.test(v) ? v : randomUUID();
}
