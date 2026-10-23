import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 for S3-compatible buckets (Railway Buckets, MinIO, R2), without an SDK
 * dependency. Covers what the app needs: presigned GET URLs and signed PUT requests.
 */

export type S3Config = {
  endpoint: string; // e.g. https://storage.railway.app or http://localhost:9000
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as S3 expects: everything except A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export function uriEncode(s: string, keepSlash = false): string {
  let out = "";
  for (const ch of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += "%" + ch.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function amzDates(now: Date) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string, region: string) {
  return hmac(hmac(hmac(hmac("AWS4" + secret, dateStamp), region), "s3"), "aws4_request");
}

/** Host and canonical path for an object key (virtual-hosted style unless forcePathStyle). */
export function objectLocation(cfg: S3Config, key: string) {
  const u = new URL(cfg.endpoint);
  const encodedKey = uriEncode(key, true);
  if (cfg.forcePathStyle) {
    return { origin: `${u.protocol}//${u.host}`, host: u.host, path: `/${uriEncode(cfg.bucket)}/${encodedKey}` };
  }
  const host = `${cfg.bucket}.${u.host}`;
  return { origin: `${u.protocol}//${host}`, host, path: `/${encodedKey}` };
}

/** Presigned GET URL (query-string authentication). Extra params such as response-content-disposition are signed too. */
export function presignGetUrl(cfg: S3Config, key: string, opts: { expiresIn: number; now?: Date; extraQuery?: Record<string, string> }) {
  const { amzDate, dateStamp } = amzDates(opts.now ?? new Date());
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const loc = objectLocation(cfg, key);
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(opts.expiresIn),
    "X-Amz-SignedHeaders": "host",
    ...(opts.extraQuery ?? {}),
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&");
  const canonicalRequest = ["GET", loc.path, query, `host:${loc.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp, cfg.region)).update(stringToSign).digest("hex");
  return `${loc.origin}${loc.path}?${query}&X-Amz-Signature=${signature}`;
}

/** Headers for a signed PUT of the whole object (single request; objects here are at most 25 MB). */
export function signPutHeaders(cfg: S3Config, key: string, body: Uint8Array, contentType: string, now = new Date()) {
  const { amzDate, dateStamp } = amzDates(now);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const loc = objectLocation(cfg, key);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { "content-type": contentType, host: loc.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = ["PUT", loc.path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp, cfg.region)).update(stringToSign).digest("hex");
  return {
    url: `${loc.origin}${loc.path}`,
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
