/**
 * W3C import parsing and pure rules (docs/security.md §2.6, §4.7; docs/data-migration-plan.md §7, §8, §9.4):
 * import.values_only, import.rejects_macro, import.row_cap, export.formula_neutralized (templates and result
 * files), date/number formats of the mapping (A-MIG-04), opening status rules (A-MIG-06), chunking, guard.
 */
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/export-xlsx";
import { chunkByGroup, getImportKind, loaderGuard, openingStatus, parseDate, parseDecimal, templateFile, wizardPostGuard } from "@/modules/imports";
import { parseImportFile, ParseError } from "@/modules/imports/parse";
import { resultCsv } from "@/modules/imports/outputs";
import { autoMap, similarity } from "@/modules/imports/kinds/values";

const LIMITS = { maxRows: 1000 };
const csv = (s: string) => new TextEncoder().encode(s);

/** Minimal zip writer for crafted workbooks (deflate), so the tests control every part. */
function zip(entries: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [n, text] of Object.entries(entries)) {
    const name = Buffer.from(n);
    const data = Buffer.from(text, "utf8");
    const comp = deflateRawSync(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(comp.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(name.length, 26);
    locals.push(l, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const workbook = (sheet: string, extra: Record<string, string> = {}) =>
  zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>code</t></si><si><t>qty</t></si><si><t>expiry</t></si><si><r><t>MAT-</t></r><r><t>0012</t></r></si></sst>`,
    "xl/styles.xml": `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet,
    ...extra,
  });

describe("import.parse CSV", () => {
  it("reads quoted fields, embedded quotes and line breaks, drops a BOM and blank rows", () => {
    const s = parseImportFile("a.csv", csv('﻿code,name\r\nMAT-1,"Oil, ""RBD""\nline 2"\r\n\r\nMAT-2,Glycerin\r\n'), LIMITS);
    expect(s.headers).toEqual(["code", "name"]);
    expect(s.rows).toEqual([
      ["MAT-1", 'Oil, "RBD"\nline 2'],
      ["MAT-2", "Glycerin"],
    ]);
    expect(s.sourceRowNumbers).toEqual([2, 5]);
  });

  it("detects a semicolon delimiter and keeps formula-looking values verbatim (stored, neutralised on export)", () => {
    const s = parseImportFile("a.csv", csv("code;name\nMAT-1;=HYPERLINK(\"http://x\")\n"), LIMITS);
    expect(s.rows[0][1]).toBe('=HYPERLINK("http://x")');
    expect(s.notes[0]).toContain(";");
  });

  it("refuses non-UTF-8 text, duplicate headers, unclosed quotes and files over the row cap (import.row_cap)", () => {
    expect(() => parseImportFile("a.csv", Uint8Array.from([0x63, 0x6f, 0x64, 0x65, 0x0a, 0xff, 0xfe]), LIMITS)).toThrow(/UTF-8/);
    expect(() => parseImportFile("a.csv", csv("code,Code\n1,2\n"), LIMITS)).toThrow(/appears twice/);
    expect(() => parseImportFile("a.csv", csv('code\n"open\n'), LIMITS)).toThrow(/never closed/);
    const big = "code\n" + Array.from({ length: 11 }, (_, i) => `M${i}`).join("\n");
    const e = (() => {
      try {
        parseImportFile("a.csv", csv(big), { maxRows: 10 });
      } catch (x) {
        return x as ParseError;
      }
    })();
    expect(e).toBeInstanceOf(ParseError);
    expect(e!.kind).toBe("too_large");
  });

  it("refuses macro workbooks, old .xls and mismatched content", () => {
    expect(() => parseImportFile("book.xlsm", csv("x"), LIMITS)).toThrow(/Macro-enabled/);
    expect(() => parseImportFile("book.xls", csv("x"), LIMITS)).toThrow(/\.xls/);
    expect(() => parseImportFile("book.xlsx", csv("code\n1\n"), LIMITS)).toThrow(/not an Excel workbook/);
    expect(() => parseImportFile("data.pdf", csv("x"), LIMITS)).toThrow(/CSV/);
  });
});

describe("import.parse XLSX (values only)", () => {
  it("reads shared and rich strings, numbers as decimal strings, date cells as ISO and formula cells by their cached value only (import.values_only)", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><f>SUM(1,2)*0.1</f><v>0.30000000000000004</v></c><c r="C2" s="1"><v>46081</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>=cmd|' /C calc'!A0</t></is></c><c r="B3"><v>12.5</v></c></row>
    </sheetData></worksheet>`;
    const s = parseImportFile("book.xlsx", workbook(sheet), LIMITS);
    expect(s.format).toBe("xlsx");
    expect(s.headers).toEqual(["code", "qty", "expiry"]);
    expect(s.rows[0]).toEqual(["MAT-0012", "0.3", "2026-02-28"]);
    expect(s.rows[1]).toEqual(["=cmd|' /C calc'!A0", "12.5", ""]);
    expect(s.formulaCells).toBe(1);
    expect(s.notes.join(" ")).toMatch(/formulas were ignored/);
  });

  it("refuses a workbook that carries a VBA project even when named .xlsx (import.rejects_macro)", () => {
    const bad = workbook(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`, { "xl/vbaProject.bin": "macro" });
    expect(() => parseImportFile("book.xlsx", bad, LIMITS)).toThrow(/Macro-enabled/);
  });

  it("reads the workbooks the application writes (template round trip)", () => {
    const s = parseImportFile("t.xlsx", new Uint8Array(buildXlsx([["code", "name"], ["MAT-1", "Oil"]])), LIMITS);
    expect(s.rows).toEqual([["MAT-1", "Oil"]]);
  });
});

describe("mapping values (A-MIG-04)", () => {
  it("parses dates in the declared format and refuses impossible dates", () => {
    expect(parseDate("31/01/2027", "DD/MM/YYYY")).toBe("2027-01-31");
    expect(parseDate("01/31/2027", "MM/DD/YYYY")).toBe("2027-01-31");
    expect(parseDate("2027-01-31", "DD/MM/YYYY")).toBe("2027-01-31");
    expect(parseDate("31/02/2027", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("01/31/2027", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("1/1/27", "DD/MM/YYYY")).toBeNull();
  });

  it("parses numbers with the declared separators, never through floats", () => {
    expect(parseDecimal("1,234.5", ".", ",")).toBe("1234.5");
    expect(parseDecimal("1.234,5", ",", ".")).toBe("1234.5");
    expect(parseDecimal("0.1", ".", "none")).toBe("0.1");
    expect(parseDecimal("12,34.5", ".", ",")).toBeNull();
    expect(parseDecimal("1e3", ".", ",")).toBeNull();
    expect(parseDecimal("abc", ".", ",")).toBeNull();
  });

  it("maps headers to template columns by name and alias", () => {
    expect(autoMap(getImportKind("materials").columns, ["Material Code", "Name", "Class", "UOM"])).toMatchObject({ code: "Material Code", name: "Name", material_class: "Class", uom_base: "UOM", inci_name: null });
  });

  it("similarity ≥ 0.85 flags near-identical names only (§8 tier 3)", () => {
    expect(similarity("Coconut Oil", "Coconut  oil.")).toBe(1);
    expect(similarity("Coconut Oil RBD", "Coconut Oil")).toBeLessThan(1);
    expect(similarity("Glycerin", "Palm Oil")).toBeLessThan(0.3);
  });
});

describe("export.formula_neutralized for templates and result files", () => {
  it("prefixes formula-looking cells with a quote in CSV and writes XLSX cells as inline strings", () => {
    const body = resultCsv(["name"], [{ rowNo: 2, raw: { name: "=HYPERLINK(1)" }, result: "rejected", errorMessage: "+bad", warnings: ["@x"] }]).toString("utf8");
    expect(body).toContain(`"'=HYPERLINK(1)"`);
    expect(body).toContain(`"'+bad"`);
    expect(body).toContain(`"'@x"`);
    const t = templateFile(getImportKind("opening_stock"), "xlsx");
    expect(t.body.subarray(0, 2).toString()).toBe("PK");
    const parsed = parseImportFile("t.xlsx", new Uint8Array(t.body), LIMITS);
    expect(parsed.headers).toContain("count_sheet_ref");
    expect(parsed.rows[0].join(" ")).toMatch(/fictional/);
  });
});

describe("opening status (A-MIG-06, setting imports.opening_stock.status_rules)", () => {
  const rules = { expiryRequiredClasses: ["raw_material", "product"], supplierLotRequiredClasses: ["raw_material"] };
  const today = "2026-10-24";
  it("expired before missing data, on hold for missing expiry or supplier lot, quarantine otherwise; never released", () => {
    expect(openingStatus({ itemClass: "raw_material", expiresOn: "2026-10-23", supplierLotNumber: null, today }, rules).status).toBe("expired");
    expect(openingStatus({ itemClass: "raw_material", expiresOn: null, supplierLotNumber: "S1", today }, rules)).toMatchObject({ status: "on_hold", reasonCode: "expiry_unknown" });
    expect(openingStatus({ itemClass: "raw_material", expiresOn: "2027-01-01", supplierLotNumber: null, today }, rules)).toMatchObject({ status: "on_hold", reasonCode: "documentation_issue" });
    expect(openingStatus({ itemClass: "packaging", expiresOn: null, supplierLotNumber: null, today }, rules).status).toBe("quarantine");
    expect(openingStatus({ itemClass: "raw_material", expiresOn: today, supplierLotNumber: "S1", today }, rules).status).toBe("quarantine");
  });
});

describe("engine chunking", () => {
  it("never splits a group (one opening lot) across chunks", () => {
    const items = ["a", "a", "b", null, "c", "c", "c", "a"].map((g, i) => ({ groupKey: g, i }));
    const chunks = chunkByGroup(items, 3);
    for (const g of ["a", "c"]) expect(chunks.filter((c) => c.some((x) => x.groupKey === g)).length).toBe(1);
    expect(chunks.flat().length).toBe(items.length);
  });
});

describe("migration window guard (US-2-25 AC2, A-MIG-08)", () => {
  it("refuses production without the window, and --post without the window and read-only mode", () => {
    expect(loaderGuard({ APP_ENV: "production" }, { mode: "dry_run", readOnlyEnabled: true }).ok).toBe(false);
    expect(loaderGuard({ APP_ENV: "production", MIGRATION_WINDOW_OPEN: "true" }, { mode: "dry_run", readOnlyEnabled: false }).ok).toBe(true);
    expect(loaderGuard({ APP_ENV: "staging" }, { mode: "dry_run", readOnlyEnabled: false }).ok).toBe(true);
    expect(loaderGuard({ APP_ENV: "staging" }, { mode: "post", readOnlyEnabled: true }).ok).toBe(false);
    expect(loaderGuard({ APP_ENV: "production", MIGRATION_WINDOW_OPEN: "true" }, { mode: "post", readOnlyEnabled: false }).ok).toBe(false);
    expect(loaderGuard({ APP_ENV: "production", MIGRATION_WINDOW_OPEN: "true" }, { mode: "post", readOnlyEnabled: true }).ok).toBe(true);
    expect(wizardPostGuard({ APP_ENV: "production" }, true).ok).toBe(false);
    expect(wizardPostGuard({ APP_ENV: "production" }, false).ok).toBe(true);
    expect(wizardPostGuard({ APP_ENV: "development" }, true).ok).toBe(true);
  });
});
