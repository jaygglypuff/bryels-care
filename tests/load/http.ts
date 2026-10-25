/**
 * HTTP helpers for the load driver (US-9-01): a per-virtual-user cookie jar, sign-in through the real
 * server action, server-action calls by exported name (ids read from the production build's
 * server-reference manifest), page GETs and `/api/v1` commands. Node 22 fetch only; no dependencies.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type ManifestEntry = { filename: string; exportedName: string };

/** Server action id by "<file>#<export>", e.g. "app/(app)/inventory/scan/actions.ts#scanCardAction". */
export function actionIds(buildDir = path.resolve(".next")): Map<string, string> {
  const m = JSON.parse(readFileSync(path.join(buildDir, "server", "server-reference-manifest.json"), "utf8")) as { node: Record<string, ManifestEntry> };
  const out = new Map<string, string>();
  for (const [id, e] of Object.entries(m.node)) out.set(`${e.filename}#${e.exportedName}`, id);
  return out;
}

export type Sample = { name: string; ms: number; status: number; ok: boolean; expected?: boolean };

export class Client {
  private cookies = new Map<string, string>();
  constructor(
    readonly base: string,
    private readonly record: (s: Sample) => void,
  ) {}

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (v === "" || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
  }

  hasSession() {
    return [...this.cookies.keys()].some((k) => k.endsWith("bc_session"));
  }

  async timed(name: string, url: string, init: RequestInit, okStatuses: number[] = [200], expectedStatuses: number[] = []): Promise<Response | null> {
    const t0 = performance.now();
    let status = 0;
    let res: Response | null = null;
    try {
      res = await fetch(this.base + url, { redirect: "manual", ...init, headers: { cookie: this.cookieHeader(), origin: this.base, ...(init.headers as Record<string, string>) } });
      status = res.status;
      this.keep(res);
      await res.arrayBuffer();
    } catch {
      status = 0;
    }
    const ms = performance.now() - t0;
    this.record({ name, ms, status, ok: okStatuses.includes(status), expected: expectedStatuses.includes(status) });
    return res;
  }

  /** GET of a server-rendered page (the full render including its queries). */
  page(name: string, url: string) {
    return this.timed(name, url, { method: "GET", headers: { accept: "text/html" } });
  }

  /** A server action called as the browser does (Next-Action header, React-encoded arguments). */
  action(name: string, pageUrl: string, id: string, body: BodyInit, contentType?: string, okStatuses = [200, 303]) {
    const headers: Record<string, string> = { "next-action": id, accept: "text/x-component" };
    if (contentType) headers["content-type"] = contentType;
    return this.timed(name, pageUrl, { method: "POST", headers, body }, okStatuses);
  }

  /** `useActionState` form actions take (prevState, formData): React encodes the FormData as "$K1" with entries prefixed "_1_". */
  formAction(name: string, pageUrl: string, id: string, fields: Record<string, string>) {
    const fd = new FormData();
    // The entries first, the root last: the server resolves "$K1" when "0" arrives (as React's encodeReply does).
    for (const [k, v] of Object.entries(fields)) fd.set(`_1_${k}`, v);
    fd.set("0", JSON.stringify(["$undefined", "$K1"]));
    return this.action(name, pageUrl, id, fd);
  }

  /** `/api/v1` command with a fresh idempotency key; 409/429 are expected outcomes, not errors. */
  command(name: string, url: string, body: unknown, key: string) {
    return this.timed(name, url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) }, [200], [409, 429]);
  }
}
