import { describe, expect, it } from "vitest";
import { contentDisposition, getStorage, objectKey, presignGetUrl, signDownloadUrl, sniffType, stripPng, stripWebp, validateUpload, verifyDownloadSignature } from "@/lib/storage";

/** Pure tests of the storage adapter pieces (no database). */
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle));

describe("S3 SigV4 presigning", () => {
  it("matches the published AWS query-string authentication example", () => {
    // Example from the AWS S3 documentation "Authenticating Requests: Using Query Parameters" (documented sample credentials).
    const url = presignGetUrl(
      { endpoint: "https://s3.amazonaws.com", bucket: "examplebucket", region: "us-east-1", accessKeyId: ["AKIA", "IOSFODNN7EXAMPLE"].join(""), secretAccessKey: ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/"), forcePathStyle: false },
      "test.txt",
      { expiresIn: 86400, now: new Date("2013-05-24T00:00:00Z") },
    );
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true);
    expect(url.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")).toBe(true);
  });

  it("uses path style when configured and signs response overrides", () => {
    const url = presignGetUrl({ endpoint: "http://localhost:9000", bucket: "files", region: "us-east-1", accessKeyId: "k", secretAccessKey: "s", forcePathStyle: true }, "org/a/b", {
      expiresIn: 60,
      extraQuery: { "response-content-disposition": contentDisposition("CoA é.pdf") },
    });
    expect(url.startsWith("http://localhost:9000/files/org/a/b?")).toBe(true);
    expect(url).toContain("response-content-disposition=attachment%3B");
  });
});

describe("storage configuration", () => {
  it("is null (setup required) unless FILE_STORAGE and its variables are set", () => {
    expect(getStorage({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getStorage({ FILE_STORAGE: "s3", S3_BUCKET: "x" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getStorage({ FILE_STORAGE: "local" } as unknown as NodeJS.ProcessEnv)?.driver).toBe("local");
    expect(
      getStorage({ FILE_STORAGE: "s3", S3_ENDPOINT: "https://e.test", S3_BUCKET: "b", S3_REGION: "r", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s" } as unknown as NodeJS.ProcessEnv)?.driver,
    ).toBe("s3");
  });

  it("object keys are opaque org/<uuid>/<uuid>", () => {
    expect(objectKey("0192f0c4-0000-7000-8000-000000000001", "0192f0c4-0000-7000-8000-000000000002")).toBe("org/0192f0c4-0000-7000-8000-000000000001/0192f0c4-0000-7000-8000-000000000002");
    expect(() => objectKey("../etc", "passwd")).toThrow();
  });
});

describe("signed download links", () => {
  it("are bound to the user, tamper-evident and expire after 5 minutes", () => {
    const id = "0192f0c4-0000-7000-8000-000000000009";
    const now = Date.now();
    const u = new URL(signDownloadUrl(id, "user-a", now), "http://x");
    const p = { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
    expect(verifyDownloadSignature(id, "user-a", p, now)).toBe(true);
    expect(verifyDownloadSignature(id, "user-b", p, now)).toBe(false);
    expect(verifyDownloadSignature("0192f0c4-0000-7000-8000-000000000010", "user-a", p, now)).toBe(false);
    expect(verifyDownloadSignature(id, "user-a", { ...p, exp: String(Number(p.exp) + 10) }, now)).toBe(false);
    expect(verifyDownloadSignature(id, "user-a", p, now + 301_000)).toBe(false);
  });
});

describe("upload sanitising", () => {
  it("sniffs allowed types only", () => {
    expect(sniffType(Uint8Array.from(ascii("%PDF-1.7")))).toBe("application/pdf");
    expect(sniffType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffType(Uint8Array.from(ascii("<html>")))).toBeNull();
    expect(sniffType(Uint8Array.from(ascii("MZ\x90\x00")))).toBeNull();
  });

  it("strips PNG text chunks and WebP EXIF/XMP chunks", () => {
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...ascii(type), ...data, 0, 0, 0, 0];
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", new Array(13).fill(1)), ...chunk("tEXt", ascii("Author\0secret")), ...chunk("IDAT", [1, 2, 3]), ...chunk("IEND", [])]);
    const outPng = stripPng(png);
    expect(has(outPng, "secret")).toBe(false);
    expect(has(outPng, "IDAT")).toBe(true);

    const wchunk = (fourcc: string, data: number[]) => [...ascii(fourcc), data.length, 0, 0, 0, ...data, ...(data.length % 2 ? [0] : [])];
    const body = [...ascii("WEBP"), ...wchunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...wchunk("VP8 ", [1, 2, 3, 4]), ...wchunk("EXIF", ascii("GPS-SECRET")), ...wchunk("XMP ", ascii("xmp-secret"))];
    const webp = Uint8Array.from([...ascii("RIFF"), body.length, 0, 0, 0, ...body]);
    const outWebp = stripWebp(webp);
    expect(has(outWebp, "GPS-SECRET")).toBe(false);
    expect(has(outWebp, "xmp-secret")).toBe(false);
    expect(outWebp[20] & 0x0c).toBe(0); // VP8X EXIF/XMP flags cleared
    const riffSize = outWebp[4] | (outWebp[5] << 8) | (outWebp[6] << 16) | (outWebp[7] << 24);
    expect(riffSize).toBe(outWebp.length - 8);
    expect(validateUpload({ fileName: "a.webp", declaredType: "image/webp", bytes: webp }).metadataStripped).toBe(true);
  });
});
