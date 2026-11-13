import { GuideView } from "./guide-view";
import { loadGuide } from "./guides";
import { HelpSheet } from "./help-sheet";

/**
 * Server wrapper: `<Help screen="inventory.move" />` renders the "?" for a screen. Without a
 * published guide the sheet says so ("No guide for this screen yet"), never a dead link.
 *
 * ADR-132 §5 (C report B22): one help door per page. A plain "?" for the whole screen hides itself where the frame's
 * "?" shows (office roles from 640 px; globals.css `[data-frame-help] [data-page-help]`); on phones and for floor
 * roles, which have no frame "?", it stays. A "?" with its own words or for one step always shows.
 */
export function Help({ screen, step, label, text }: { screen: string; step?: string | null; label?: string; text?: string }) {
  const guide = loadGuide(screen);
  if (!guide) {
    return (
      <HelpSheet title="Help" meta={null} label={label} text={text} pageDoor={!text && !step}>
        <p className="text-[14px] text-muted">No guide for this screen yet. Ask your site manager or the warehouse lead.</p>
      </HelpSheet>
    );
  }
  return (
    <HelpSheet title={guide.title} label={label} text={text} pageDoor={!text && !step} meta={`Version ${guide.version}${guide.updatedAt ? ` · updated ${guide.updatedAt}` : ""}`}>
      <GuideView guide={guide} step={step} />
    </HelpSheet>
  );
}
