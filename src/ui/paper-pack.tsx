"use client";
import { CheckCircle2, CloudOff, Printer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { syncAgent } from "@/lib/offline/agent";
import { printPackHtml } from "@/lib/offline/paper-packs";
import type { CachedPaperPack } from "@/lib/offline/store";
import { buttonClass, cx } from "./core";

/**
 * ADR-134: "Print the paper record" and the hint "Ready to print without internet ✓". The batch page passes the pack
 * version the server knows; the device keeps its own copy (IndexedDB, deleted at sign-out) and prints that copy, so the
 * button works when the internet is gone. When the copy is missing or old and the device is online, it is downloaded
 * first.
 */
export function PaperPackPrint({ userId, batchId, version, size = "lg" }: { userId: string; batchId: string; version: string | null; size?: "md" | "lg" }) {
  const [copy, setCopy] = useState<CachedPaperPack | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "missing" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const have = await syncAgent().paperPack(userId, batchId);
      setCopy(have);
      if (!version) return setState(have ? "ready" : "missing");
      if (have && have.version === version) return setState("ready");
      if (!navigator.onLine) return setState(have ? "ready" : "missing");
      setState("saving");
      const saved = await syncAgent().savePaperPackOf(userId, batchId);
      setCopy(saved);
      setState(saved ? "ready" : "missing");
    } catch {
      setState(copy ? "ready" : "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, batchId, version]);

  useEffect(() => {
    void load();
  }, [load]);

  const print = async () => {
    setMessage(null);
    try {
      let c = copy;
      if (!c && navigator.onLine) c = await syncAgent().savePaperPackOf(userId, batchId);
      if (!c) {
        setMessage(navigator.onLine ? "There is no paper record for this batch yet." : "This paper record was not saved on this device before the internet went down. Print it from another device, or use blank paper and write the batch number on every page.");
        return;
      }
      setCopy(c);
      await printPackHtml(c.html);
    } catch {
      setMessage("Printing did not start. Try again, or use Chrome's menu › Print.");
    }
  };

  const ready = state === "ready" && !!copy;
  return (
    <div className="flex flex-col gap-2" data-testid="paper-pack-print">
      <button type="button" onClick={() => void print()} disabled={state === "loading" || state === "saving"} className={cx(buttonClass("secondary", size), "min-h-[44px]")} data-testid="print-paper-record">
        <Printer size={18} aria-hidden /> Print the paper record
      </button>
      <p className={cx("flex items-center gap-1.5 text-[14px]", ready ? "text-[var(--ok-fg)]" : "text-muted")} role="status" data-testid="paper-pack-hint">
        {state === "loading" ? (
          "Checking this device…"
        ) : state === "saving" ? (
          "Saving it on this device…"
        ) : ready ? (
          <>
            <CheckCircle2 size={16} aria-hidden /> Ready to print without internet ✓
            {version && copy && copy.version !== version ? " (an older copy; it updates when the internet is back)" : ""}
          </>
        ) : state === "error" ? (
          <>
            <CloudOff size={16} aria-hidden /> Not saved on this device yet. Open this page again while the internet works.
          </>
        ) : version ? (
          <>
            <CloudOff size={16} aria-hidden /> Not saved on this device yet. Open this page again while the internet works.
          </>
        ) : (
          "No paper record yet."
        )}
      </p>
      {message && (
        <p className="text-[14px] text-[var(--warn-fg)]" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * ADR-134: on "My jobs", quietly saves the paper records of today's and the next batches on this device (and again
 * when the internet comes back), and says how many are ready to print without internet.
 */
export function PaperPackPrefetch({ userId }: { userId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        if (navigator.onLine) await syncAgent().refreshPaperPacks(userId);
      } catch {
        // No connection: the copies already on the device stay.
      }
      const all = await syncAgent().paperPacks(userId).catch(() => []);
      if (alive) setCount(all.length);
    };
    void run();
    window.addEventListener("online", run);
    return () => {
      alive = false;
      window.removeEventListener("online", run);
    };
  }, [userId]);
  if (!count) return null;
  return (
    <p className="flex items-center gap-1.5 text-[14px] text-fg-2" data-testid="paper-packs-ready">
      <CheckCircle2 size={16} className="text-[var(--ok-fg)]" aria-hidden />
      {count === 1 ? "1 paper batch record is" : `${count} paper batch records are`} ready to print without internet.{" "}
      <a href="/offline#paper" className="inline-flex min-h-[44px] items-center font-medium text-primary-text underline">
        See them
      </a>
    </p>
  );
}
