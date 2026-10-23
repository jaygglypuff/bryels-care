import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@/lib/errors";
import { presignGetUrl, signPutHeaders, type S3Config } from "./sigv4";

export { validateUpload, sniffType, stripJpeg, stripPng, stripWebp, UPLOAD_LIMITS, type ValidatedUpload, type AllowedType } from "./sanitize";
export { presignGetUrl, signPutHeaders, uriEncode, objectLocation, type S3Config } from "./sigv4";

/**
 * File storage adapter (ADR-014, docs/deployment-railway.md §4, docs/security.md §4.6, §4.8).
 *
 * FILE_STORAGE=local  development: files under FILE_STORAGE_DIR (default ./.data/files, never served statically)
 * FILE_STORAGE=s3     staging/production: private S3-compatible bucket (Railway Bucket) via S3_* variables
 * unset               uploads show the "File storage isn't set up" state; nothing fakes success
 */
export type StorageDriver = "local" | "s3";

export interface StorageAdapter {
  readonly driver: StorageDriver;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Short-lived direct link (s3 only); local files are streamed by the application endpoint. */
  presignDownload?(key: string, opts: { fileName: string; contentType: string; expiresIn: number }): string;
}

const KEY_RE = /^org\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/** Opaque object key: org/<org-uuid>/<attachment-uuid>; the original name is never part of it. */
export function objectKey(organizationId: string, attachmentId: string): string {
  const k = `org/${organizationId}/${attachmentId}`;
  if (!KEY_RE.test(k)) throw new Error("invalid object key");
  return k;
}

class LocalStorage implements StorageAdapter {
  readonly driver = "local" as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    if (!KEY_RE.test(key)) throw new Error("invalid object key");
    return path.join(this.root, ...key.split("/"));
  }
  async put(key: string, body: Uint8Array) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body, { flag: "wx" });
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.file(key)));
  }
}

class S3Storage implements StorageAdapter {
  readonly driver = "s3" as const;
  constructor(private readonly cfg: S3Config) {}
  async put(key: string, body: Uint8Array, contentType: string) {
    const { url, headers } = signPutHeaders(this.cfg, key, body, contentType);
    const res = await fetch(url, { method: "PUT", headers, body: Buffer.from(body) });
    if (!res.ok) throw new Error(`Bucket upload failed with HTTP ${res.status}`);
  }
  async get(key: string) {
    const res = await fetch(presignGetUrl(this.cfg, key, { expiresIn: 60 }));
    if (!res.ok) throw new Error(`Bucket download failed with HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  presignDownload(key: string, opts: { fileName: string; contentType: string; expiresIn: number }) {
    return presignGetUrl(this.cfg, key, {
      expiresIn: opts.expiresIn,
      extraQuery: {
        "response-content-disposition": contentDisposition(opts.fileName),
        "response-content-type": opts.contentType,
      },
    });
  }
}

/** The configured adapter, or null when storage is not set up (callers render the S state). */
export function getStorage(env: NodeJS.ProcessEnv = process.env): StorageAdapter | null {
  const kind = (env.FILE_STORAGE ?? "").trim().toLowerCase();
  if (kind === "local") return new LocalStorage(path.resolve(env.FILE_STORAGE_DIR || ".data/files"));
  if (kind === "s3") {
    const need = ["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
    if (need.some((n) => !env[n])) return null;
    return new S3Storage({
      endpoint: env.S3_ENDPOINT!,
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    });
  }
  return null;
}

/** Throws the 503 "setup required" error when storage is not configured. */
export function requireStorage(): StorageAdapter {
  const s = getStorage();
  if (!s) throw new DomainError("setup_required", "File storage isn't set up. Ask the system administrator to configure FILE_STORAGE (see the deployment guide).");
  return s;
}

export function storageFor(driver: string): StorageAdapter {
  const s = requireStorage();
  if (s.driver !== driver) throw new DomainError("setup_required", `This file is stored in the ${driver} backend, which is not the configured one (${s.driver}).`);
  return s;
}

/** RFC 6266 attachment header with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/* ------------------------------------------------------------------ signed application URLs (§4.8) */

export const DOWNLOAD_TTL_SECONDS = 300; // A-SEC-19

let devSecret: string | null = null;
function urlSecret(): string {
  const s = process.env.FILE_URL_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new DomainError("setup_required", "Download links aren't set up: FILE_URL_SECRET (32+ characters) is missing.");
  }
  // Development only: a per-process secret (links stop working after a restart; TTL is 5 minutes anyway).
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const mac = (id: string, userId: string, exp: number) => createHmac("sha256", urlSecret()).update(`${id}|${userId}|${exp}`).digest("base64url");

/** A link to /api/v1/files/<id> bound to one user and valid for 5 minutes. */
export function signDownloadUrl(attachmentId: string, userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + DOWNLOAD_TTL_SECONDS;
  return `/api/v1/files/${attachmentId}?exp=${exp}&sig=${mac(attachmentId, userId, exp)}`;
}

/** Verifies a signed link for the given user; false when expired, tampered or issued to someone else. */
export function verifyDownloadSignature(attachmentId: string, userId: string, params: { exp?: string | null; sig?: string | null }, now = Date.now()): boolean {
  const exp = Number(params.exp);
  if (!Number.isInteger(exp) || !params.sig) return false;
  if (exp < Math.floor(now / 1000) || exp > Math.floor(now / 1000) + DOWNLOAD_TTL_SECONDS + 5) return false;
  const expected = Buffer.from(mac(attachmentId, userId, exp));
  const given = Buffer.from(params.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
