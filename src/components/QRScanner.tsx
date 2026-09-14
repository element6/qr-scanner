import { useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { ImageScanControl } from "./ImageScanControl";

type QRScannerProps = {
  paused: boolean;
  onScan: (detectedCodes: Array<{ rawValue: string }>) => void;
  onError: (err: unknown) => void;
  deviceConstraints: { facingMode: "environment" };
  onToggle: () => void;
  /** Image path — owned by App, presented here so drag & drop lands on the frame (R2). */
  imageBusy: boolean;
  imageStatus: string | null;
  onImageFile: (file: File | null) => void;
  onImagePasteClick: () => void;
};

export function QRScanner({
  paused,
  onScan,
  onError,
  deviceConstraints,
  onToggle,
  imageBusy,
  imageStatus,
  onImageFile,
  onImagePasteClick,
}: QRScannerProps) {
  const scannerRunning = !paused;
  const frameRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function enter(e: React.DragEvent) {
    e.preventDefault();
    if (imageBusy) return;
    dragDepth.current++;
    setDragActive(true);
  }
  function over(e: React.DragEvent) {
    e.preventDefault();
    if (imageBusy) return;
    e.dataTransfer.dropEffect = "copy";
  }
  function leave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }
  function drop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (imageBusy) return;
    onImageFile(e.dataTransfer.files[0] ?? null);
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Camera</span>
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${
              scannerRunning
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {scannerRunning ? "Scanning" : "Paused"}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div
          ref={frameRef}
          onDragEnter={enter}
          onDragOver={over}
          onDragLeave={leave}
          onDrop={drop}
          className={`relative w-full aspect-square max-w-[400px] mx-auto overflow-hidden rounded-lg bg-black ring-offset-2 transition ${
            dragActive
              ? "ring-4 ring-emerald-400 ring-offset-slate-50"
              : "ring-0"
          }`}
        >
          <Scanner
            onScan={onScan}
            onError={onError}
            constraints={deviceConstraints}
            paused={paused}
            components={{
              finder: false,
              onOff: true,
              torch: true,
              zoom: true,
            }}
            classNames={{
              container: "w-full h-full",
              video: "w-full h-full object-cover",
            }}
          />
          <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute top-[12%] left-[12%] w-8 h-8 border-l-4 border-t-4 border-emerald-500 rounded-tl-lg" />
            <div className="absolute top-[12%] right-[12%] w-8 h-8 border-r-4 border-t-4 border-emerald-500 rounded-tr-lg" />
            <div className="absolute bottom-[12%] left-[12%] w-8 h-8 border-l-4 border-b-4 border-emerald-500 rounded-bl-lg" />
            <div className="absolute bottom-[12%] right-[12%] w-8 h-8 border-r-4 border-b-4 border-emerald-500 rounded-br-lg" />
            <div className="absolute left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-[scan_2s_ease-in-out_infinite]" />
          </div>
        </div>
        <div className="mt-3 flex justify-center">
          <button
            onClick={onToggle}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              scannerRunning
                ? "bg-red-500 hover:bg-red-600"
                : "bg-emerald-500 hover:bg-emerald-600"
            }`}
          >
            {scannerRunning ? "Pause Scanning" : "Start Scanning"}
          </button>
        </div>
        <ImageScanControl
          busy={imageBusy}
          status={imageStatus}
          onFile={onImageFile}
          onPasteClick={onImagePasteClick}
        />
      </div>
    </section>
  );
}
