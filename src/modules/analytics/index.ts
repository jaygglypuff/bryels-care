export {
  BOARD_LIMIT,
  FULFILMENT_STATUSES,
  NEAR_EXPIRY_WINDOW_DAYS,
  getOperatorHome,
  getOwnerDashboard,
  isOrganizationWide,
  resolveScope,
} from "./dashboard";
export type { ActivityRow, BoardCard, DashboardScope, NearExpiryLot, OperatorTile, OwnerDashboard } from "./dashboard";
// Wave 3 W3A: KPI engine, dashboards, drill-down, trends (US-5-01..03, US-5-16)
export {
  AREAS,
  COMPARISONS,
  COMPARISON_KPIS,
  OWNER_TILE_CODES,
  PERIOD_LABELS,
  RECORD_LIMIT,
  TREND_MAX_SERIES,
  TREND_SPANS,
  canSeeCrossSite,
  canSeeKpi,
  deleteTrendView,
  drillHref,
  getAreaDashboard,
  getKpiRecords,
  getOwnerOverview,
  getTrends,
  listKpiDefinitions,
  listTrendViews,
  resolveKpiScope,
  saveTrendView,
  snapshotFreshness,
  trendCatalogue,
} from "./kpis";
export type {
  AreaDashboard,
  AreaKey,
  Breakdown,
  Comparison,
  DayPoint,
  DefinitionEntry,
  Freshness,
  KpiMeta,
  KpiNumber,
  KpiRecords,
  KpiScope,
  KpiTile,
  ListRow,
  OwnerOverview,
  PeriodDto,
  SavedViewConfig,
  SiteComparisonRow,
  SparkPoint,
  TrendSeries,
  Trends,
  UnavailableTile,
} from "./kpis";
export { DASHBOARD_KPIS, KPIS, OWNER_KPIS, UNAVAILABLE_KPIS, kpiByCode } from "./kpi/catalogue";
export type { KpiAggregate, KpiDefinition, KpiUnit, ValueLabel } from "./kpi/catalogue";
export { PERIOD_KEYS, isPeriodKey } from "./kpi/time";
export type { Grain, PeriodKey } from "./kpi/time";
export { analyticsReconcileKpisJob, analyticsSnapshotKpisJob } from "./jobs";
