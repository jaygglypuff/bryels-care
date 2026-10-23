/** Public API of the platform module: background jobs, notifications, diagnostics. */
export { defineJob, createJobRegistry, JOB_CODE_RE, type JobDefinition, type JobRunContext, type JobRegistry, type AnyJobDefinition } from "./job-definition";
export { JOB_DEFINITIONS, appJobRegistry } from "./job-handlers";
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
