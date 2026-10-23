/**
 * The application job registry: every job the worker runs is listed here (docs/architecture.md §8).
 * To add a job: create `src/modules/<module>/jobs/<name>.ts` exporting `defineJob({...})`, then add
 * ONE import line and ONE list entry below. Enqueuing or running a code that is not in this list
 * fails; the registry test checks every code against the table in docs/architecture.md §8.
 */
import { inventoryRebuildBalancesJob, inventoryReconcileJob } from "@/modules/inventory/jobs";
import { type AnyJobDefinition, type JobRegistry, createJobRegistry } from "./job-definition";

export const JOB_DEFINITIONS: AnyJobDefinition[] = [
  inventoryReconcileJob,
  inventoryRebuildBalancesJob,
  // Wave 1 integrator: add other streams' jobs here (e.g. documents.render, inventory.expiry_scan).
];

let registry: JobRegistry | null = null;

/** Lazily built so module import order (and import cycles through job modules) never matters. */
export function appJobRegistry(): JobRegistry {
  registry ??= createJobRegistry(JOB_DEFINITIONS);
  return registry;
}
