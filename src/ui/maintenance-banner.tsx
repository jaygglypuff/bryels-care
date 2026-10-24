import { Banner } from "./status";

/** US-2-30: shown on every page while the read-only maintenance mode is on. */
export function MaintenanceBanner({ canWrite }: { canWrite: boolean }) {
  return (
    <div className="mb-4" role="status">
      <Banner tone="warn" title="Read-only for maintenance">
        {canWrite
          ? "The system is being prepared. Your role is on the allow-list, so you can still change data; everyone else can only look."
          : "The system is being prepared. You can look things up, but changes are paused and will not be saved until this banner is gone."}
      </Banner>
    </div>
  );
}
