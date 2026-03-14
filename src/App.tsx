"use client";

import { useEffect, useMemo, useState } from "react";
import { Header, Notification, QRScanner, LastScan, ScanHistory, ClearConfirmModal } from "./components";

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
  const [notification, setNotification] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

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

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowClearConfirm(false);
    };
    if (showClearConfirm) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showClearConfirm]);

  const handleScan = (detectedCodes: Array<{ rawValue: string }>) => {
    if (!detectedCodes.length) return;

    const nextValue = detectedCodes[0].rawValue;
    if (!nextValue) return;

    if (nextValue === scannedData) return;

    setScannedData(nextValue);
    setPaused(true);
    setError(null);

    setHistory((prevHistory) => {
      const nextHistory = [
        { data: nextValue, timestamp: new Date().toISOString() },
        ...prevHistory,
      ].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
      return nextHistory;
    });

    setNotification("Scan saved to history");
  };

  const handleError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    setNotification("Camera error: " + message);
    console.error("Scanner error:", err);
  };

  const clearHistory = () => {
    setHistory([]);
    setNotification("History cleared");
    localStorage.removeItem(STORAGE_KEY);
  };

  const confirmClear = () => {
    clearHistory();
    setShowClearConfirm(false);
  };

  const copyToClipboard = async () => {
    if (!scannedData) return;
    try {
      await navigator.clipboard.writeText(scannedData);
      setNotification("Copied latest scan to clipboard");
    } catch (err) {
      console.error("Copy failed", err);
      setNotification("Copy failed");
    }
  };

  const openUrl = () => {
    if (isValidUrl(scannedData)) {
      window.open(scannedData, "_blank");
    }
  };

  const copyHistoryItem = async (data: string) => {
    try {
      await navigator.clipboard.writeText(data);
      setNotification("Copied history item");
    } catch {
      setNotification("Copy failed");
    }
  };

  const toggleExpand = (index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const deleteHistoryItem = (index: number) => {
    const nextHistory = history.filter((_, i) => i !== index);
    setHistory(nextHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
    setNotification("History item deleted");
  };

  const deviceConstraints = useMemo(
    () => ({ facingMode: "environment" as const }),
    []
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Header />

        <Notification message={notification} />

        <QRScanner
          paused={paused}
          onScan={handleScan}
          onError={handleError}
          deviceConstraints={deviceConstraints}
        />

        <LastScan
          scannedData={scannedData}
          error={error}
          onCopy={copyToClipboard}
          onOpenUrl={openUrl}
          onClearHistory={() => setShowClearConfirm(true)}
          isValidUrl={isValidUrl}
        />

        <ScanHistory
          history={history}
          expandedItems={expandedItems}
          onCopyHistoryItem={copyHistoryItem}
          onToggleExpand={toggleExpand}
          onDeleteItem={deleteHistoryItem}
        />

        <ClearConfirmModal
          show={showClearConfirm}
          historyCount={history.length}
          onCancel={() => setShowClearConfirm(false)}
          onConfirm={confirmClear}
        />
      </div>
    </main>
  );
}
