"use client";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { GuideView } from "./guide-view";
import type { Guide } from "./guides";

export type FrameHelpResult = { guide: Guide | null };

/**
 * The frame's Help "?" (round 4, UX re-audit C #9): one 44 px button in the top bar on every screen. It opens the
 * quick guide for the screen you are on in a sheet over the page (a bottom sheet on phones); nothing navigates,
 * so closing it returns to the same place with typed values intact. The guide is fetched when the button is
 * pressed (`load`, a server action), so pages carry no help text they do not show.
 */
export function FrameHelp({ load, withLabel = false, labelClass = "hidden 2xl:inline" }: { load: (pathname: string) => Promise<FrameHelpResult>; withLabel?: boolean; /** Round 5: where the word "Help" shows (Tailwind classes). */ labelClass?: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ path: string; guide: Guide | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // ADR-136: the page's "This screen is for…" sentence (PageIntro, hidden under the title where this "?" exists).
  const [about, setAbout] = useState<string | null>(null);

  async function open() {
    const intro = document.querySelector<HTMLElement>("main [data-page-intro] [data-testid=page-intro-text]");
    setAbout(intro?.textContent?.trim() || null);
    ref.current?.showModal();
    if (state?.path === pathname) return;
    setLoading(true);
    setFailed(false);
    try {
      const r = await load(pathname);
      setState({ path: pathname, guide: r.guide });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const guide = state?.path === pathname ? state.guide : null;
  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        aria-label="Help for this screen"
        title="Help for this screen"
        data-testid="frame-help"
        className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[13px] font-medium text-fg-2 hover:bg-surface-3 hover:text-fg pointer-coarse:h-11 pointer-coarse:min-w-11"
      >
        <HelpCircle size={18} aria-hidden />
        {withLabel && <span className={labelClass}>Help</span>}
      </button>
      <dialog
        ref={ref}
        aria-label={guide?.title ?? "Help"}
        className="m-0 mt-auto w-full max-w-none rounded-t-[8px] border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/30 sm:m-auto sm:max-w-[560px] sm:rounded-[8px]"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">{guide?.title ?? "Help"}</h2>
            {guide && <p className="text-[12px] text-muted">Version {guide.version}{guide.updatedAt ? ` · updated ${guide.updatedAt}` : ""}</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="inline-flex min-h-[36px] items-center rounded-[6px] border border-line-strong px-3 text-[14px] font-medium hover:bg-surface-2 pointer-coarse:min-h-[44px]">
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {about && (
            <section aria-label="About this screen" className="mb-3 border-b border-line pb-3" data-testid="help-about">
              <h3 className="text-[13px] font-semibold text-fg-2">About this screen</h3>
              <p className="mt-1 text-[14px] text-fg">{about}</p>
            </section>
          )}
          {loading ? (
            <p className="text-[14px] text-muted" role="status">Opening the guide…</p>
          ) : failed ? (
            <p className="text-[14px] text-muted" role="alert">Help needs a connection. Your entries on this screen are kept. Try again in a moment.</p>
          ) : guide ? (
            <GuideView guide={guide} />
          ) : (
            <p className="text-[14px] text-muted">No guide for this screen yet. Ask your site manager.</p>
          )}
          <p className="mt-4 border-t border-line pt-3 text-[13px]">
            <a href="/help" className="inline-flex min-h-[44px] items-center font-medium text-primary-text hover:underline">All guides and the word list</a>
          </p>
        </div>
      </dialog>
    </>
  );
}
