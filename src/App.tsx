"use client";

import { useEffect, useMemo, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";

type HistoryItem = { data: string; timestamp: string };
const STORAGE_KEY = "qrScanHistory";
const MAX_HISTORY = 50;

const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export default function App() {
  const [scannedData, setScannedData] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as HistoryItem[];
      setHistory(parsed);
    } catch (err) {
      console.warn("Failed to parse scan history", err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const persistHistory = (next: HistoryItem[]) => {
    setHistory(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const handleScan = (detectedCodes: Array<{ rawValue: string }>) => {
    if (!detectedCodes.length) return;

    const nextValue = detectedCodes[0].rawValue;
    if (!nextValue) return;

    if (nextValue === scannedData) return;

    setScannedData(nextValue);
    setPaused(true);

    const nextHistory = [
      { data: nextValue, timestamp: new Date().toISOString() },
      ...history,
    ].slice(0, MAX_HISTORY);

    persistHistory(nextHistory);
  };

  const handleError = (err: unknown) => {
    if (err instanceof Error) {
      setError(err.message);
    } else {
      setError(String(err));
    }
    console.error("Scanner error:", err);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const copyToClipboard = async () => {
    if (!scannedData) return;
    try {
      await navigator.clipboard.writeText(scannedData);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  const openUrl = () => {
    if (isValidUrl(scannedData)) {
      window.open(scannedData, "_blank");
    }
  };

  const deviceConstraints = useMemo(
    () => ({ facingMode: "environment" as const }),
    []
  );

  const scannerRunning = !paused;
  const openUrlVisible = !!scannedData && isValidUrl(scannedData);

  const toggleScanner = () => {
    setError(null);
    setPaused((prev) => !prev);
  };

  return (
    <div>
      <div className="relative w-full max-w-md mx-auto border-2 border-blue-500 rounded-lg overflow-hidden mb-6">
        <Scanner
          onScan={handleScan}
          onError={handleError}
          constraints={deviceConstraints}
          paused={paused}
          components={{ finder: true, onOff: true, torch: true, zoom: true }}
          classNames={{ container: "w-full h-full", video: "w-full h-full" }}
        />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={toggleScanner}
          aria-pressed={scannerRunning}
          className={`px-4 py-2 rounded text-white ${
            scannerRunning
              ? "bg-red-500 hover:bg-red-700"
              : "bg-green-500 hover:bg-green-700"
          }`}
        >
          {scannerRunning ? "Pause scanning" : "Start scanning"}
        </button>
        <span className="text-sm font-medium">
          {scannerRunning ? "● Scanning" : "○ Paused"}
        </span>
      </div>

      <div className="p-4 border border-gray-300 rounded mb-3 min-h-[20px] bg-gray-50">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : (
          scannedData || "No QR code detected yet."
        )}
      </div>

      <div className="mb-4">
        <button
          onClick={copyToClipboard}
          disabled={!scannedData}
          className="bg-green-500 hover:bg-green-700 text-white px-4 py-2 rounded mr-2"
        >
          Copy to Clipboard
        </button>

        {openUrlVisible && (
          <button
            onClick={openUrl}
            className="bg-indigo-500 hover:bg-indigo-700 text-white px-4 py-2 rounded"
          >
            Open URL
          </button>
        )}
      </div>

      <div className="history mt-8 border-t border-gray-200 pt-6">
        <h2 className="text-lg font-semibold mb-2">Scan History</h2>
        <button
          onClick={clearHistory}
          className="bg-red-500 hover:bg-red-700 text-white px-3 py-1 rounded mb-3"
        >
          Clear History
        </button>

        <div>
          {history.length === 0 ? (
            <p className="text-gray-500">No scan history yet.</p>
          ) : (
            history.map((item, index) => (
              <div
                key={`${item.timestamp}-${index}`}
                className="history-item p-2 border-b border-gray-100 break-all cursor-pointer hover:bg-gray-50"
                onClick={() => navigator.clipboard.writeText(item.data)}
              >
                <div className="timestamp text-gray-500 text-xs">
                  {new Date(item.timestamp).toLocaleString()}
                </div>
                <div>{item.data}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
