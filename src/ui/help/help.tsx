import { GuideView } from "./guide-view";
import { loadGuide } from "./guides";
import { HelpSheet } from "./help-sheet";

/**
 * Server wrapper: `<Help screen="inventory.move" />` renders the "?" for a screen. Without a
 * published guide the sheet says so ("No guide for this screen yet"), never a dead link.
 */
export function Help({ screen, step }: { screen: string; step?: string | null }) {
  const guide = loadGuide(screen);
  if (!guide) {
    return (
      <HelpSheet title="Help" meta={null}>
        <p className="text-[14px] text-muted">No guide for this screen yet. Ask your site manager or the warehouse lead.</p>
      </HelpSheet>
    );
  }
  return (
    <HelpSheet title={guide.title} meta={`Version ${guide.version}${guide.updatedAt ? ` · updated ${guide.updatedAt}` : ""}`}>
      <GuideView guide={guide} step={step} />
    </HelpSheet>
  );
}
