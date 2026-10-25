/**
 * Device identity (docs/offline-sync.md §6, data-model §11.1): a random key and a monotonic command
 * sequence, kept in localStorage so they survive sign-out (the registration belongs to the device,
 * not to the person). The key identifies the installation; it never authenticates anyone.
 */
export type KeyValueStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

const KEY = "bc.device.v1";
type Identity = { key: string; nextSequence: number };

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function read(storage: KeyValueStorage): Identity | null {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? "null") as Identity | null;
    return v && typeof v.key === "string" && Number.isSafeInteger(v.nextSequence) ? v : null;
  } catch {
    return null;
  }
}

export function deviceIdentity(storage: KeyValueStorage): Identity {
  const existing = read(storage);
  if (existing) return existing;
  const fresh = { key: randomKey(), nextSequence: 1 };
  storage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

/** Reserves the next command sequence number (gaps are harmless; order is what matters). */
export function nextSequence(storage: KeyValueStorage): number {
  const id = deviceIdentity(storage);
  storage.setItem(KEY, JSON.stringify({ ...id, nextSequence: id.nextSequence + 1 }));
  return id.nextSequence;
}

/** A removed device starts again with a new key (it must be registered again). */
export function resetDeviceIdentity(storage: KeyValueStorage) {
  const old = read(storage);
  storage.setItem(KEY, JSON.stringify({ key: randomKey(), nextSequence: old?.nextSequence ?? 1 }));
}
