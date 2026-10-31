export {
  BOARD_LIMIT,
  FULFILMENT_STATUSES,
  NEAR_EXPIRY_WINDOW_DAYS,
  getOperatorHome,
  getOwnerDashboard,
  isOrganizationWide,
  listRecentActivity,
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
  getKpiTile,
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
// ADR-081: Operations Center pipeline (five-destination navigation)
export { ACTIVE_BATCH_LIMIT, PIPELINE_STAGE_KEYS, getOperationsCenter } from "./operations-center";
export type { ActiveBatch, OperationsCenter, PipelinePart, PipelineStage, PipelineStageKey } from "./operations-center";
// Owner Home (ADR-083 §4, mockup panel 1): one source per label, see owner-home.ts
export { getOwnerHome, listStockAlerts, listWeekBatches, stockAlertCounts } from "./owner-home";
export type { OwnerHome, SalesDay, StockAlertCounts, StockAlertLot, StockAlerts, WeekBatch, WeekBatches } from "./owner-home";
// ADR-088: Reports landing page (grade-5 business overview), best-selling products
export { getTopProducts } from "./top-products";
export type { TopProduct, TopProducts } from "./top-products";
