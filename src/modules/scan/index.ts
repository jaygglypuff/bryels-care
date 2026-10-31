/** Public surface of the scan module: resolves scans into result cards across inventory, documents and quality, and searches typed words. */
export { keywordMatches, resolveScanCard, type KeywordMatch, type ScanCard, type ScanAction, type ScanFact } from "./card";
export { searchEverything, searchTerms, GROUP_LIMIT, type SearchGroup, type SearchGroupKey, type SearchHit } from "./search";
export { findPickCandidates, resolvePickRef } from "./pick";
