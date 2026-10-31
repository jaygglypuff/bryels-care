/**
 * "Which label goes where?" (ADR-099): one card per label kind with where it is printed, where it is stuck
 * and when its code is scanned. Shown on "Labels printed" and when "Print a label" is opened without a record.
 */
const ROWS: { label: string; print: string; stick: string; scan: string }[] = [
  { label: "Sack label", print: "On the delivery: Print labels", stick: "On each sack, drum or tub that came in", scan: "At put-away, and when you take it for a batch" },
  { label: "Product label", print: "On the batch's packaging step", stick: "On each bar or jar", scan: "At boxing, or on the Scan screen" },
  { label: "Box label", print: "On the box: Print box label", stick: "On the side of the box", scan: "When you move, pick or ship the box" },
  { label: "Shelf label", print: "On the shelf: ⋯ More › Print a label", stick: "On the front edge of the shelf", scan: "At put-away, to say where the stock goes" },
  { label: "Lot label (again)", print: "On the lot: ⋯ More › Print a label", stick: "When a label is lost or the status changed", scan: "Like the first label" },
];

export function LabelGuide() {
  return (
    <section aria-label="Which label goes where" className="space-y-2" data-testid="label-guide">
      <h2 className="text-[17px] font-semibold">Which label goes where?</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {ROWS.map((r) => (
          <li key={r.label} className="rounded-[14px] border border-line bg-surface p-3 text-[15px]">
            <p className="font-semibold text-fg">{r.label}</p>
            <p className="text-fg-2"><span className="font-medium text-fg">Print:</span> {r.print}</p>
            <p className="text-fg-2"><span className="font-medium text-fg">Stick:</span> {r.stick}</p>
            <p className="text-fg-2"><span className="font-medium text-fg">Scan:</span> {r.scan}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
