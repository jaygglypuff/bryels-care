"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Button, Card, inputClass } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { scanAction } from "./actions";

type Detector = { detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export function ScanForm() {
  const [state, action] = useActionState<ActionState, FormData>(scanAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraSupported, setCameraSupported] = useState<boolean | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    setCameraSupported(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  // Keep the wedge input focused after every result so the next scan lands in it.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state]);

  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code", "code_128", "data_matrix"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue && inputRef.current) {
              inputRef.current.value = codes[0].rawValue;
              setCameraOn(false);
              formRef.current?.requestSubmit();
              return;
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setCameraError("The camera could not be opened. Allow camera access, or use a scanner or type the code.");
        setCameraOn(false);
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraOn]);

  return (
    <div className="space-y-4">
      <Card>
        <form ref={formRef} action={action} className="space-y-3">
          <label htmlFor="code" className="flex items-center gap-2 text-[15px] font-semibold">
            <ScanLine size={18} /> Scan a label or type a number
          </label>
          <input
            ref={inputRef}
            id="code"
            name="code"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="BC:LOT:L-2610-00001 · L-2610-00001 · B-26-0001 · SO-26-00001 · DR-26-00001"
            className={`${inputClass} min-h-[60px] font-mono text-[18px]`}
          />
          <FormMessage state={state} />
          <SubmitButton size="lg" variant="cta" pendingText="Looking up…" className="w-full sm:w-auto">
            Look up
          </SubmitButton>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 text-[15px] font-semibold">Camera</h2>
        {cameraSupported === null ? null : cameraSupported ? (
          <div className="space-y-3">
            {cameraOn && <video ref={videoRef} className="aspect-video w-full rounded-[12px] bg-black object-cover" muted playsInline />}
            <Button type="button" variant="secondary" onClick={() => { setCameraError(null); setCameraOn((v) => !v); }}>
              {cameraOn ? <><CameraOff size={16} /> Stop camera</> : <><Camera size={16} /> Scan with camera</>}
            </Button>
            {cameraError && <p className="text-[13px] text-[var(--bad-fg)]">{cameraError}</p>}
          </div>
        ) : (
          <p className="text-[13px] text-muted" data-testid="camera-fallback">
            Camera scanning is not available in this browser (it needs the BarcodeDetector feature, e.g. Chrome on Android). Use a handheld scanner, which types into the box above, or type the number.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-[15px] font-semibold">What can I scan?</h2>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-fg-2">
          <li>Lot labels (<code>BC:LOT:…</code>) or a lot number such as <code>L-2610-00001</code> → lot page</li>
          <li>Batch numbers (<code>B-26-…</code>) → production batch</li>
          <li>Sales order (<code>SO-26-…</code>) or delivery receipt (<code>DR-26-…</code>) numbers → sales order</li>
          <li>Goods receipt numbers (<code>GR-26-…</code>), location labels (<code>BC:LOC:…</code>) and material labels (<code>BC:MAT:…</code>)</li>
        </ul>
        <p className="mt-2 text-[12px] text-muted">Only records in your sites are found.</p>
      </Card>
    </div>
  );
}
