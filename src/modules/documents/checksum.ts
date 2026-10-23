import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted recursively, no whitespace (stable checksums). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** definition_checksum = sha256 of the canonical JSON (docs/reports-and-templates.md §1.2). */
export function definitionChecksum(definition: unknown): string {
  return sha256Hex(canonicalJson(definition));
}
