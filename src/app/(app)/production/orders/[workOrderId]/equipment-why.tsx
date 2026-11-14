"use client";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { useClientKey } from "@/ui/use-client-key";
import { recordCleaningAction } from "./flow-actions";

export type BlockedEquipment = { id: string; code: string; name: string; usable: boolean; why: string[]; canRecordCleaning: boolean; fixHelp: string[] };

/**
 * ADR-110 C5: equipment that blocks Save says WHY in plain words, right where the person works (never under
 * "More details"), and offers "Record cleaning" when cleaning is the fix and the person may record it.
 */
export function EquipmentWhy({ items, title }: { items: BlockedEquipment[]; title: string }) {
  const blocked = items.filter((i) => !i.usable);
  if (!blocked.length) return null;
  return (
    <div className="rounded-[8px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3 text-[15px] text-[var(--warn-fg)]" data-testid="equipment-why" role="status">
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {blocked.map((e) => (
          <li key={e.id} data-code={e.code}>
            {e.why.map((w) => (
              <p key={w}>{w}.</p>
            ))}
            {e.fixHelp.map((h) => (
              <p key={h} className="text-[14px]">
                {h}
              </p>
            ))}
            {e.canRecordCleaning && <RecordCleaning id={e.id} code={e.code} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordCleaning({ id, code }: { id: string; code: string }) {
  const key = useClientKey(); // after hydration (ADR-125): no random value in the server HTML
  const [state, action] = useInPlaceAction(recordCleaningAction);
  return (
    <form action={action} className="mt-2 flex flex-col gap-1">
      <input type="hidden" name="equipmentId" value={id} />
      <input type="hidden" name="code" value={code} />
      {key && <input type="hidden" name="idempotencyKey" value={key} />}
      <SubmitButton variant="secondary" size="lg" pendingText="Saving…">
        {`Record cleaning of ${code}`}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
