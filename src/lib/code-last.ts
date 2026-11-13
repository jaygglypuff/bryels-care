/**
 * Names before codes in short feed lines (UX audit C #6, round 2 part 2): a stored message title such as
 * "Order SO-26-00012 confirmed" or "Purchase order PO-26-00002 waits for approval" is shown as
 * "Order confirmed" with "SO-26-00012" small and grey after it. Record numbers are matched by their shape
 * (letters, dash, digits: B-26-0003, BM-2610-0026, DRM-2610-018, SUP-0006); the words around them stay.
 * Pure (unit-tested); the stored title is unchanged.
 */
const RECORD_NO = /(?<!\bshelf\s)\b(?:DR\s+)?[A-Z]{1,5}-\d{2,4}(?:-\d{2,7})?\b/g;

export function codeLast(title: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  const text = title
    .replace(RECORD_NO, (m) => {
      codes.push(m.replace(/^DR\s+/, ""));
      return " ";
    })
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([:,.;)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:·-]+|[\s:·-]+$/g, "")
    .trim();
  if (!text) return { text: title, codes: [] };
  return { text: text.charAt(0).toUpperCase() + text.slice(1), codes };
}
