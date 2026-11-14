/**
 * ADR-110 C14: the two "who may say OK" rules side by side, read from the configuration, so QA sees why a delivery and
 * a finished batch differ. The values are QA's configuration (A-QA-LOTBATCH-01: QA decides whether they should match).
 */
export function QaRules({ rules }: { rules: { lotTesterMayRelease: boolean; batchTesterMayRelease: boolean } }) {
  return (
    <div className="mt-3 rounded-[8px] border border-line bg-surface-2/40 px-3 py-2 text-[13px] text-fg-2" data-testid="qa-rules">
      <p className="font-medium text-fg">Who may say OK (rules set by QA)</p>
      <ul className="mt-1 list-disc pl-5">
        <li>Deliveries (lots): {rules.lotTesterMayRelease ? "the person who entered the results may also say OK." : "the person who received the lot or entered its results may not say OK; another QA person does."}</li>
        <li>Finished batches: {rules.batchTesterMayRelease ? "the person who entered the test results may also say OK (the batch record says so)." : "another QA person reviews the tests and says OK."} The person who made, weighed or checked the batch never does.</li>
      </ul>
    </div>
  );
}
