"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";

/**
 * Reads QR codes from the device camera, continuously.
 *
 * Two decoders, because one is not enough. `BarcodeDetector` is native, fast
 * and battery-cheap, and Safari does not have it — which would be a detail
 * except that the people standing on a gate are overwhelmingly holding
 * iPhones. So jsQR decodes canvas frames wherever the native one is missing.
 *
 * The manual box is not a fallback for developers; it is the thing that works
 * when a lens is wet, a badge is behind a scratched lanyard sleeve, or a
 * phone's autofocus refuses in flat grey light. A gate tool with no way to
 * type the code in is a gate tool that stops working in the rain.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

/** How often to decode. 8/s reads instantly and leaves the CPU alone. */
const SCAN_INTERVAL_MS = 125;

export function QrScanner({
  onScan,
  paused,
  disabled,
}: {
  /** Called with the raw contents of the code — a URL, usually. */
  onScan: (value: string) => void;
  /** Stop decoding without tearing the camera down, e.g. while a result shows. */
  paused?: boolean;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  // Read inside the decode loop, which must not restart when `paused` flips —
  // tearing down the interval on every scan makes the camera stutter.
  const pausedRef = useRef(Boolean(paused));
  const onScanRef = useRef(onScan);

  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    pausedRef.current = Boolean(paused);
  }, [paused]);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  // Releasing the camera on unmount is not housekeeping: a phone that keeps
  // the torch and sensor running flattens its battery over a race weekend.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera. Without this a phone opens the selfie camera and
        // the marshal has to hold the badge behind their own head.
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (window.BarcodeDetector) {
        detectorRef.current = new window.BarcodeDetector({
          formats: ["qr_code"],
        });
      }
      setActive(true);
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Camera permission was refused. Allow it in the browser settings, or type the code in below."
          : "No camera available here. Type the code in below.",
      );
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(async () => {
      if (pausedRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;

      try {
        if (detectorRef.current) {
          const [found] = await detectorRef.current.detect(video);
          if (found?.rawValue) onScanRef.current(found.rawValue);
          return;
        }

        const canvas = (canvasRef.current ??= document.createElement("canvas"));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height, {
          // A badge in a lanyard sleeve is often photographed through glare,
          // which inverts locally; trying both costs one pass over the frame.
          inversionAttempts: "attemptBoth",
        });
        if (found?.data) onScanRef.current(found.data);
      } catch {
        // A dropped frame is not worth telling anybody about; the next one is
        // 125 ms away. Only camera *setup* failures surface to the marshal.
      }
    }, SCAN_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [active]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-brand-black/20 bg-brand-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`aspect-[4/3] w-full object-cover ${active ? "" : "opacity-0"}`}
        />
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-white/70">
              {error ?? "The camera is off."}
            </p>
            <Button
              size="sm"
              variant="primary"
              disabled={disabled}
              onClick={() => void start()}
            >
              Start camera
            </Button>
          </div>
        )}
        {active && (
          <>
            {/* A frame to aim with. Purely visual — decoding uses the whole
                image, so a badge slightly outside the box still reads. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-2/3 w-2/3 rounded-lg border-4 ${
                  paused ? "border-white/30" : "border-brand-red"
                }`}
              />
            </div>
            <button
              type="button"
              className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
              onClick={stop}
            >
              Stop
            </button>
          </>
        )}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = manual.trim();
          if (!value) return;
          onScanRef.current(value);
          setManual("");
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          placeholder="Or type / paste the code"
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button
          size="sm"
          variant="outline"
          type="submit"
          disabled={disabled || manual.trim().length === 0}
        >
          Check
        </Button>
      </form>
    </div>
  );
}
