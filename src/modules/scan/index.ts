/** Public surface of the scan module: resolves scans into result cards across inventory, documents and quality, and searches typed words. */
export { keywordMatches, resolveScanCard, type KeywordMatch, type ScanCard, type ScanAction, type ScanFact } from "./card";
export { searchEverything, searchTerms, GROUP_LIMIT, type SearchGroup, type SearchGroupKey, type SearchHit } from "./search";
export { findPickCandidates, resolvePickRef } from "./pick";
export { masterSearch, viewableTypes, statusWords, RECORD_TYPES, MASTER_GROUP_LABEL, MAX_QUERY_LENGTH, NUMBER_GROUP_LIMIT, TYPE_LIMIT, type HitIcon, type MasterGroup, type MasterGroupKey, type MasterHit, type MasterSearchResult } from "./master-search";
export { parseNumberQuery, wantsPartial, NUMBER_SHAPES, type NumberQuery, type NumberShape } from "./number-query";
