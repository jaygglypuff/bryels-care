"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * The "?" button and the guide sheet (US-2-27 AC1). The sheet is a modal <dialog> over the task:
 * nothing navigates, so closing it returns to the same step with entered values intact. On a
 * phone it is a bottom sheet; on wider screens a centred panel.
 */
export function HelpSheet({ title, meta, children, label = "Help for this screen", text }: { title: string; meta: string | null; children: ReactNode; label?: string; text?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => ref.current?.showModal()}
        className={`inline-flex ${text ? "min-h-[44px] px-4 gap-1 text-[14px]" : "h-9 w-9 text-[15px]"} shrink-0 items-center justify-center rounded-full border border-line bg-surface font-semibold text-primary-text hover:bg-primary-soft focus-visible:outline-2`}
      >
        {/* With a visible text ("Help: weighing") the text says it all; the bare "?" is for icon-only buttons. */}
        {text ? <span>{text}</span> : "?"}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        className="m-0 mt-auto w-full max-w-none rounded-t-[20px] border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/30 sm:m-auto sm:max-w-[560px] sm:rounded-[20px]"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">{title}</h2>
            {meta && <p className="text-[12px] text-muted">{meta}</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-full border border-line px-3 py-1 text-[13px]" autoFocus>
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{online ? children : <p className="text-[14px] text-muted">Help needs a connection. Your entries on this screen are kept.</p>}</div>
      </dialog>
    </>
  );
}
