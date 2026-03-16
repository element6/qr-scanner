"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Header,
  Notification,
  QRScanner,
  LastScan,
  ScanHistory,
  ClearConfirmModal,
} from "./components";
import {
  useHistory,
  useHistoryExpanded,
  useClipboard,
  useNotification,
  useKeyboardShortcuts,
} from "./hooks";
import { isValidUrl } from "./utils/validators";

// Shortcut notification messages as constants
const SHORTCUT_HELP_MESSAGE =
  "Shortcuts: c=copy, o=open URL, space=toggle scan";
const SCAN_SAVED_MESSAGE = "Scan saved to history";
const COPY_SUCCESS_MESSAGE = "Copied latest scan to clipboard";
const COPY_FAILED_MESSAGE = "Copy failed";
const HISTORY_COPIED_MESSAGE = "Copied history item";
const HISTORY_CLEARED_MESSAGE = "History cleared";
const HISTORY_DELETED_MESSAGE = "History item deleted";

export default function App() {
  const [scannedData, setScannedData] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Use custom hooks for separation of concerns
  const { history, addScan, removeItem, clearHistory } = useHistory();
  const { expandedItems, toggleExpand } = useHistoryExpanded();
  const { copy: copyToClipboard } = useClipboard();
  const { message: notification, notify } = useNotification();

  // Handle Escape key for modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowClearConfirm(false);
    };
    if (showClearConfirm) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showClearConfirm]);

  const handleScan = useCallback(
    (detectedCodes: Array<{ rawValue: string }>) => {
      if (!detectedCodes.length) return;

      const nextValue = detectedCodes[0].rawValue;
      if (!nextValue) return;

      if (nextValue === scannedData) return;

      setScannedData(nextValue);
      setPaused(true);
      setError(null);

      // Use the hook to add to history (handles localStorage internally)
      addScan(nextValue);

      notify(SCAN_SAVED_MESSAGE);
    },
    [scannedData, addScan, notify]
  );

  const handleError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      notify("Camera error: " + message);
      console.error("Scanner error:", err);
    },
    [notify]
  );

  const handleCopyCurrent = useCallback(async () => {
    if (!scannedData) return;
    const result = await copyToClipboard(scannedData);
    notify(result.success ? COPY_SUCCESS_MESSAGE : COPY_FAILED_MESSAGE);
  }, [scannedData, copyToClipboard, notify]);

  const handleOpenUrl = useCallback(() => {
    if (isValidUrl(scannedData)) {
      window.open(scannedData, "_blank");
    }
  }, [scannedData]);

  const handleCopyHistoryItem = useCallback(
    async (data: string) => {
      const result = await copyToClipboard(data);
      notify(result.success ? HISTORY_COPIED_MESSAGE : COPY_FAILED_MESSAGE);
    },
    [copyToClipboard, notify]
  );

  const handleDeleteItem = useCallback(
    (index: number) => {
      removeItem(index);
      notify(HISTORY_DELETED_MESSAGE);
    },
    [removeItem, notify]
  );

  const handleConfirmClear = useCallback(() => {
    clearHistory();
    notify(HISTORY_CLEARED_MESSAGE);
    setShowClearConfirm(false);
  }, [clearHistory, notify]);

  const toggleScanner = useCallback(() => {
    setError(null);
    setPaused((prev) => !prev);
  }, []);

  // Keyboard shortcuts using useKeyboardShortcuts hook
  const shortcuts = useMemo(
    () => [
      {
        key: "c",
        handler: () => scannedData && handleCopyCurrent(),
      },
      {
        key: "o",
        handler: () => isValidUrl(scannedData) && handleOpenUrl(),
      },
      {
        key: " ",
        handler: () => toggleScanner(),
      },
      {
        key: "?",
        handler: () => notify(SHORTCUT_HELP_MESSAGE),
      },
      {
        key: "Escape",
        handler: () => setShowClearConfirm(false),
      },
    ],
    [scannedData, handleCopyCurrent, handleOpenUrl, toggleScanner, notify]
  );
  const { handleKeyDown } = useKeyboardShortcuts(shortcuts);

  useEffect(() => {
    if (showClearConfirm) return;

    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      handleKeyDown(e);
    };

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [handleKeyDown, showClearConfirm]);

  const deviceConstraints = useMemo(
    () => ({ facingMode: "environment" as const }),
    []
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Header />

        <QRScanner
          paused={paused}
          onScan={handleScan}
          onError={handleError}
          deviceConstraints={deviceConstraints}
          onToggle={toggleScanner}
        />

        <Notification message={notification} />
        <LastScan
          scannedData={scannedData}
          error={error}
          onCopy={handleCopyCurrent}
          onOpenUrl={handleOpenUrl}
          onClearHistory={() => setShowClearConfirm(true)}
          isValidUrl={isValidUrl}
        />

        <ScanHistory
          history={history}
          expandedItems={expandedItems}
          onCopyHistoryItem={handleCopyHistoryItem}
          onToggleExpand={toggleExpand}
          onDeleteItem={handleDeleteItem}
        />

        <ClearConfirmModal
          show={showClearConfirm}
          historyCount={history.length}
          onCancel={() => setShowClearConfirm(false)}
          onConfirm={handleConfirmClear}
        />
      </div>
    </main>
  );
}
