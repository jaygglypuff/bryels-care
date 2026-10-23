/** export.formula_neutralized (docs/security.md §4.7): unit tests of the shared helpers. */
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/export-xlsx";
import { neutralizeCell, toCsv } from "@/lib/export";

/** Reads the entries of a zip written by buildXlsx (local headers in sequence). */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const data = buf.subarray(p + 30 + nameLen + extra, p + 30 + nameLen + extra + size);
    out[name] = inflateRawSync(data).toString("utf8");
    p += 30 + nameLen + extra + size;
  }
  return out;
}

describe("export.formula_neutralized", () => {
  it("prefixes cells starting with = + - @ tab or carriage return with a single quote", () => {
    for (const v of ["=1+2", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx", '=HYPERLINK("http://evil")']) expect(neutralizeCell(v)).toBe(`'${v}`);
  });

  it("leaves ordinary text, pipes and percent signs alone", () => {
    for (const v of ["L-2610-00001", "Coconut oil | RBD", "50%", "", "a=b"]) expect(neutralizeCell(v)).toBe(v);
    expect(neutralizeCell(null)).toBe("");
    expect(neutralizeCell(12.5)).toBe("12.5");
  });

  it("CSV quotes every field, doubles quotes and ends lines with CRLF", () => {
    const text = toCsv([["a", 'say "hi"'], ["'=1", ""]]).toString("utf8");
    expect(text).toBe('﻿"a","say ""hi"""\r\n"\'=1",""\r\n');
  });

  it("XLSX writes every cell as an inline string and never as a formula", () => {
    const files = unzip(buildXlsx([["Header"], ["'=1+2", "x < y & z"]], "Stock: card"));
    expect(Object.keys(files)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]);
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("'=1+2");
    expect(sheet).toContain("x &lt; y &amp; z");
    expect(files["xl/workbook.xml"]).toContain('name="Stock  card"');
  });
});
