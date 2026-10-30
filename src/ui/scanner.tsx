"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CameraOff, Flashlight, Keyboard, ScanLine } from "lucide-react";
import { createDuplicateGuard, DEFAULT_SCAN_TERMINATOR, isTerminatorKey, SCAN_TERMINATORS, type ScanTerminator } from "@/lib/scan/dedupe";
import { normalizeScanInput } from "@/lib/scan/payload";
import { Button, cx, inputClass } from "./core";

/**
 * One scan input for camera, keyboard-wedge scanner and manual entry (ADR-017; ux-system §5.9).
 *
 * - Camera: `BarcodeDetector` where the browser has it, otherwise ZXing (loaded on demand).
 *   Torch toggle when the camera supports it. Camera denied → the documented copy, wedge stays usable.
 * - Wedge: the input stays focused; a scan ends with the configured terminator (Enter, Tab or
 *   either; remembered per device because it is a property of the scanner hardware, A-UX-11).
 * - Manual: type and press Look up.
 * - The same payload within 2 s is ignored (camera frames, double sends).
 * Tests inject detections with a `BarcodeDetector` shim (docs/testing.md §2.1).
 */

type Detected = { rawValue: string; format?: string };
type Detector = { detect(src: HTMLVideoElement | HTMLCanvasElement): Promise<Detected[]> };
type DetectorCtor = (new (opts: { formats: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };

export type ScanMode = "scanner" | "camera" | "type";
const MODE_KEY = "bc.scan.mode";
const TERM_KEY = "bc.scan.terminator";

/** ZXing fallback with the same interface as BarcodeDetector (QR + Code 128 only). */
async function zxingDetector(): Promise<Detector> {
  const z = await import("@zxing/library");
  const hints = new Map();
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.QR_CODE, z.BarcodeFormat.CODE_128]);
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  const reader = new z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement("canvas");
  return {
    async detect(src) {
      const video = src as HTMLVideoElement;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      const scale = Math.min(1, 960 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const g = canvas.getContext("2d", { willReadFrequently: true });
      if (!g) return [];
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
      const lum = new Uint8ClampedArray(canvas.width * canvas.height);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      try {
        const bmp = new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(lum, canvas.width, canvas.height)));
        const r = reader.decodeWithState(bmp);
        return [{ rawValue: r.getText(), format: String(r.getBarcodeFormat()) }];
      } catch {
        return [];
      }
    },
  };
}

async function makeDetector(): Promise<{ detector: Detector; engine: "native" | "zxing" }> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Ctor) {
    try {
      const supported = (await Ctor.getSupportedFormats?.()) ?? ["qr_code", "code_128"];
      const formats = ["qr_code", "code_128"].filter((f) => supported.includes(f));
      if (formats.length) return { detector: new Ctor({ formats }), engine: "native" };
    } catch {
      /* fall through to ZXing */
    }
  }
  return { detector: await zxingDetector(), engine: "zxing" };
}

export function Scanner({
  onScan,
  pending = false,
  autoFocus = true,
  label = "Scan a label or type a number",
  placeholder = "BC:LOT:L-2610-00001 · L-2610-00001 · B-26-0001",
}: {
  onScan: (value: string) => void;
  pending?: boolean;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const guard = useRef(createDuplicateGuard());
  const [mode, setMode] = useState<ScanMode>("scanner");
  const [terminator, setTerminator] = useState<ScanTerminator>(DEFAULT_SCAN_TERMINATOR);
  const [cameraState, setCameraState] = useState<"off" | "starting" | "on" | "denied" | "unavailable">("off");
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [flash, setFlash] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY) as ScanMode | null;
      if (m === "camera" || m === "scanner" || m === "type") setMode(m);
      const t = localStorage.getItem(TERM_KEY) as ScanTerminator | null;
      if (t && (SCAN_TERMINATORS as readonly string[]).includes(t)) setTerminator(t);
    } catch {
      /* private mode */
    }
  }, []);

  const remember = (key: string, v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  };

  const emit = useCallback(
    (raw: string) => {
      const v = normalizeScanInput(raw);
      if (!v || !guard.current.accept(v)) return;
      setFlash(true);
      setTimeout(() => setFlash(false), 300);
      try {
        navigator.vibrate?.(40);
      } catch {
        /* not supported */
      }
      onScan(v);
    },
    [onScan],
  );

  // Keep the wedge input focused so the next scan lands in it.
  useEffect(() => {
    if (!pending && mode !== "camera" && autoFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [pending, mode, autoFocus]);

  // Camera loop.
  useEffect(() => {
    if (mode !== "camera") return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unavailable");
      return;
    }
    setCameraState("starting");
    (async () => {
      try {
        const { detector, engine } = await makeDetector();
        setEngine(engine);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !videoRef.current) return;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track ?? null;
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch({ supported: !!caps.torch, on: false });
        videoRef.current.srcObject = stream;
        // Do not await: some streams only start playing after the first frame; the loop tolerates "not ready".
        void videoRef.current.play().catch(() => undefined);
        setCameraState("on");
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) emit(codes[0].rawValue);
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      setCameraState("off");
    };
  }, [mode, emit]);

  const toggleTorch = async () => {
    const t = trackRef.current;
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch((s) => ({ ...s, on: !s.on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = inputRef.current?.value ?? "";
    if (inputRef.current) inputRef.current.value = "";
    emit(v);
  };

  const chooseMode = (m: ScanMode) => {
    setMode(m);
    remember(MODE_KEY, m);
  };

  return (
    <div className={cx("space-y-3 rounded-[20px] transition-shadow", flash && "ring-4 ring-[var(--ok-bd)]")} data-testid="scanner">
      <div role="radiogroup" aria-label="Scan mode" className="flex flex-wrap gap-2">
        {(
          [
            ["scanner", "Scanner", <ScanLine key="s" size={16} />],
            ["camera", "Camera", <Camera key="c" size={16} />],
            ["type", "Type", <Keyboard key="k" size={16} />],
          ] as const
        ).map(([m, text, icon]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => chooseMode(m)}
            className={cx(
              "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[14px]",
              mode === m ? "border-primary bg-primary-soft font-semibold text-primary-text" : "border-line bg-surface text-fg-2 hover:bg-surface-2",
            )}
          >
            {icon} {text}
          </button>
        ))}
      </div>

      {mode === "camera" && (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-[16px] bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera viewfinder" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-[12px] border-2 border-white/80" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {torch.supported && (
              <Button type="button" variant="secondary" onClick={toggleTorch} aria-pressed={torch.on}>
                <Flashlight size={16} /> {torch.on ? "Torch off" : "Torch on"}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => chooseMode("scanner")}>
              <CameraOff size={16} /> Stop camera
            </Button>
            <p className="text-[12px] text-muted" role="status">
              {cameraState === "starting" ? "Starting camera…" : cameraState === "on" ? `Point at the label${engine === "zxing" ? " (compatibility decoder)" : ""}.` : null}
            </p>
          </div>
          {cameraState === "denied" && (
            <p role="alert" className="rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">
              Camera access is off. Type the lot number or the material name instead.
            </p>
          )}
          {cameraState === "unavailable" && (
            <p role="alert" className="rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">
              The camera could not be opened on this device. Type the lot number or the material name instead.
            </p>
          )}
        </div>
      )}

      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="scan-input" className="flex items-center gap-2 text-[15px] font-semibold">
          <ScanLine size={18} /> {label}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            id="scan-input"
            name="code"
            data-testid="scan-input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            inputMode={mode === "scanner" ? "none" : "text"}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Tab" && isTerminatorKey("Tab", terminator)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              } else if (e.key === "Enter" && !isTerminatorKey("Enter", terminator)) {
                e.preventDefault();
              }
            }}
            className={`${inputClass} min-h-[56px] min-w-0 flex-1 font-mono text-[18px]`}
          />
          <Button type="submit" size="lg" variant="cta" disabled={pending} className="sm:w-auto">
            {pending ? "Looking up…" : "Look up"}
          </Button>
        </div>
        {mode === "scanner" && <p className="text-[12px] text-muted">Scan with a handheld scanner; the code lands here. Tap Type to use the phone keyboard.</p>}
      </form>

      <details className="text-[13px]">
        <summary className="cursor-pointer text-muted">Scanner settings</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="scan-terminator" className="text-fg-2">My scanner ends a scan with</label>
          <select
            id="scan-terminator"
            value={terminator}
            onChange={(e) => {
              const t = e.target.value as ScanTerminator;
              setTerminator(t);
              remember(TERM_KEY, t);
            }}
            className={`${inputClass} w-auto`}
          >
            <option value="enter">Enter</option>
            <option value="tab">Tab</option>
            <option value="enter_or_tab">Enter or Tab</option>
          </select>
          <span className="text-[12px] text-muted">Saved on this device.</span>
        </div>
      </details>
    </div>
  );
}
