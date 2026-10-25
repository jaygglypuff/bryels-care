/**
 * `next/headers` stand-in for vitest. Cookies are empty unless a test sets them with
 * `setTestCookies` (W4E: proves the staff context ignores the portal cookie and vice versa).
 */
const jar = new Map<string, string>();

export function setTestCookies(values: Record<string, string>) {
  jar.clear();
  for (const [k, v] of Object.entries(values)) jar.set(k, v);
}

export async function cookies() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: () => undefined,
    delete: () => undefined,
  };
}
export async function headers() {
  return new Headers();
}
