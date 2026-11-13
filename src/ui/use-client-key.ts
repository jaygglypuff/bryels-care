"use client";
import { useEffect, useState } from "react";

/**
 * A random key (idempotency key for one form) made in the browser after hydration (ADR-125 item 5). Making it in
 * `useState(() => crypto.randomUUID())` gives the server HTML one key and the browser's first render another, which
 * React reports as a hydration mismatch. Until the effect runs the key is "" (render the hidden input only when it
 * is set; the server actions treat a missing key as "no key").
 */
export function useClientKey(): string {
  return useRenewableClientKey()[0];
}

const fresh = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The same key, plus `renew()` for forms that stay on the screen after a save and may be sent again for a new thing
 * (ADR-132 §10: take out stopped stock, batch closure steps). Still "" until hydration.
 */
export function useRenewableClientKey(): [string, () => void] {
  const [key, setKey] = useState("");
  useEffect(() => {
    setKey(fresh());
  }, []);
  return [key, () => setKey(fresh())];
}
