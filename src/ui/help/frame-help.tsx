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

  async function open() {
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
        className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-card)] hover:text-fg"
      >
        <HelpCircle size={18} aria-hidden />
        {withLabel && <span className={labelClass}>Help</span>}
      </button>
      <dialog
        ref={ref}
        aria-label={guide?.title ?? "Help"}
        className="m-0 mt-auto w-full max-w-none rounded-t-[20px] border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/30 sm:m-auto sm:max-w-[560px] sm:rounded-[20px]"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">{guide?.title ?? "Help"}</h2>
            {guide && <p className="text-[12px] text-muted">Version {guide.version}{guide.updatedAt ? ` · updated ${guide.updatedAt}` : ""}</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-[14px]">
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
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
