/** Public API of the platform module: background jobs, notifications, diagnostics. */
export { defineJob, createJobRegistry, JOB_CODE_RE, type JobDefinition, type JobRunContext, type JobRegistry, type AnyJobDefinition } from "./job-definition";
export { jobDefinitions, appJobRegistry } from "./job-handlers";
export { enqueueJob, runJob, retryJob, cancelJob, listJobs, getJob, jobCounts, summarizePayload, systemContext, JOB_STATUSES, type RunOutcome } from "./jobs";
export {
  notifyUsers,
  notifyRoles,
  usersWithRoles,
  listMyNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  acknowledgeNotification,
} from "./notifications";
export { workerStatus } from "./diagnostics";
// Wave 3 W3B (US-5-13): Phase 5 diagnostics cards
export { databaseCard, importsCard, alertsCard, errorsCard, integrationsCard, registerImportStatsProvider, type DatabaseCard, type ImportsCard, type AlertsCard, type ErrorsCard, type IntegrationsCard } from "./diagnostics-phase5";
// Demo mode (ADR-055): owner-only "Reset demo data"
export { DEMO_RESET_CONFIRM_WORD, demoResetStatus, resetDemoData, type DemoResetStatus, type DemoResetRunner } from "./demo-reset";
// Wave 4 W4F (US-9-03, US-9-05): retention policies, legal holds, retention sweep, restore drills
export { RETENTION_DEFAULTS, PROTECTED_CLASSES, listRetentionPolicies, saveRetentionPolicy, confirmRetentionPolicy, periodLabel, policyKey, type PolicyView } from "./retention-policies";
export { ENTITY_LABELS, placeLegalHold, releaseLegalHold, listLegalHolds, resolveHeldSet, type LegalHoldRow } from "./retention-holds";
export { runRetentionSweep, executePurgeNow, listPurgeRuns, platformRetentionSweepJob, cutoffFor, type PurgeRunView, type TargetReport } from "./retention-sweep";
export { recordRestoreDrill, listRestoreDrills, latestRestoreDrill, signOffRestoreDrill, drillResult, type RestoreDrillView } from "./retention-drills";
