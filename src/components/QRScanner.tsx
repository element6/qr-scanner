import { Scanner } from "@yudiel/react-qr-scanner";

type QRScannerProps = {
  paused: boolean;
  onScan: (detectedCodes: Array<{ rawValue: string }>) => void;
  onError: (err: unknown) => void;
  deviceConstraints: { facingMode: "environment" };
};

export function QRScanner({ paused, onScan, onError, deviceConstraints }: QRScannerProps) {
  const scannerRunning = !paused;

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
        <div className="relative w-full aspect-square max-w-[400px] mx-auto bg-black overflow-hidden rounded-lg">
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
      </div>
    </section>
  );
}
