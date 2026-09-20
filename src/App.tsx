"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Header,
  Notification,
  QRScanner,
  ScanHistory,
  ClearConfirmModal,
  ModeTabs,
  QrGenerator,
} from "./components";
import {
  useHistory,
  useHistoryExpanded,
  useClipboard,
  useNotification,
  useKeyboardShortcuts,
  useQrCode,
} from "./hooks";
import { isValidUrl } from "./utils/validators";
import { shouldIgnoreShortcut } from "./utils/keyboardGuard";
import { describeOutcome, readClipboardImage, scanImageFile } from "./utils/scanImage";

// Shortcut notification messages as constants
const SHORTCUT_HELP_MESSAGE =
  "Shortcuts: c=copy, o=open URL, space=toggle scan";
const SCAN_SAVED_MESSAGE = "Scan saved to history";
const COPY_SUCCESS_MESSAGE = "Copied latest scan to clipboard";
const COPY_FAILED_MESSAGE = "Copy failed";
const HISTORY_COPIED_MESSAGE = "Copied history item";
const HISTORY_CLEARED_MESSAGE = "History cleared";
const HISTORY_DELETED_MESSAGE = "History item deleted";

// Tab persistence — separate key from scan history, validated on read.
const TAB_STORAGE_KEY = "qr-scanner-tab";
const VALID_TABS: ReadonlyArray<"scan" | "create"> = ["scan", "create"];

function readActiveTab(): "scan" | "create" {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (raw !== null && (VALID_TABS as readonly string[]).includes(raw)) {
      return raw as "scan" | "create";
    }
  } catch {
    // localStorage unavailable (private mode, quota) — fall through to default.
  }
  return "scan";
}

export default function App() {
  const [scannedData, setScannedData] = useState("");
  // No `error` state: camera failures surface through `notify` as a toast. The
  // only panel that ever rendered a persistent error line was LastScan, which
  // duplicated the newest history entry.
  const [paused, setPaused] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"scan" | "create">(() =>
    readActiveTab()
  );

  // Use custom hooks for separation of concerns
  const { history, addScan, removeItem, clearHistory } = useHistory();
  const { expandedItems, toggleExpand } = useHistoryExpanded();
  const { copy: copyToClipboard } = useClipboard();
  const {
    message: notification,
    tone: notificationTone,
    notify,
  } = useNotification();
  const gen = useQrCode();

  // Persist the tab choice across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      // localStorage unavailable — tab choice is not persisted this session.
    }
  }, [activeTab]);

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

  // Image-scan state — owned by App so a tab switch cannot strand a
  // "Decoding…" label (AC8). Paused lives with the camera, not here (§7.5).
  const [imageBusy, setImageBusy] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const imageBusyRef = useRef(false);

  /** Shared tail: camera and image scans write state identically (R7, §7.4).
   *  Dedupe is source-aware — camera keeps the silent early return; image
   *  surfaces "Already the latest scan" instead (Round-1 B1, §7.3).
   *  Camera pauses the feed because it just caught the code it was looking for;
   *  an image scan never touches `paused` (§7.5). */
  const applyDetectedValue = useCallback(
    (value: string, source: "camera" | "image", count?: number) => {
      if (!value) return;
      if (source === "camera") {
        if (value === scannedData) return;
        setScannedData(value);
        setPaused(true);
        addScan(value);
        notify(SCAN_SAVED_MESSAGE);
        return;
      }
      if (value === scannedData) {
        notify("Already the latest scan");
        return;
      }
      setScannedData(value);
      addScan(value);
      const suffix = count !== undefined && count > 1 ? ` — ${count} codes found` : "";
      notify(`Scanned ${value}${suffix}`);
    },
    [scannedData, addScan, notify]
  );

  const handleScan = useCallback(
    (detectedCodes: Array<{ rawValue: string }>) => {
      if (!detectedCodes.length) return;
      const nextValue = detectedCodes[0].rawValue;
      if (!nextValue) return;
      applyDetectedValue(nextValue, "camera");
    },
    [applyDetectedValue]
  );

  /** Guards: `busy` (AC7), then validation (AC5), then scanImageFile.
   *  `busy` resets in `finally`; the preprocess bounds detector time by
   *  construction, so no timeout race is needed (§7.4). */
  const handleImageFile = useCallback(
    async (file: File | null) => {
      if (!file) return; // dismissed chooser is silent (AC2)
      if (imageBusyRef.current) return; // AC7: overlapping decodes ignored
      imageBusyRef.current = true;
      setImageBusy(true);
      setImageStatus(null);
      try {
        const outcome = await scanImageFile(file);
        if (outcome.ok) {
          setImageStatus(null);
          applyDetectedValue(outcome.value, "image", outcome.count);
        } else {
          setImageStatus(describeOutcome(outcome));
        }
      } catch (err) {
        // Belt-and-braces: scanImageFile classifies failures itself; a throw
        // here means setup broke. Surface the §7.7 string, never crash (AC9).
        console.error("Image scan failed:", err);
        setImageStatus(
          describeOutcome({ ok: false, kind: "decode-failed", name: file.name })
        );
      } finally {
        setImageBusy(false);
        imageBusyRef.current = false;
      }
    },
    [applyDetectedValue]
  );

  const handleImagePasteClick = useCallback(async () => {
    if (imageBusyRef.current) return; // AC7
    const result = await readClipboardImage();
    if (result instanceof File) {
      await handleImageFile(result);
      return;
    }
    setImageStatus(describeOutcome(result)); // narrowed to ClipboardFailure
  }, [handleImageFile]);

  const handleError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      notify("Camera error: " + message, { tone: "error" });
      console.error("Scanner error:", err);
    },
    [notify]
  );

  const handleCopyCurrent = useCallback(async () => {
    if (!scannedData) return;
    const result = await copyToClipboard(scannedData);
    notify(result.success ? COPY_SUCCESS_MESSAGE : COPY_FAILED_MESSAGE, {
      tone: result.success ? "info" : "error",
    });
  }, [scannedData, copyToClipboard, notify]);

  // Takes the value explicitly rather than reading `scannedData`: the Open URL
  // action now lives on individual history rows, not on a single latest-scan
  // panel.
  const handleOpenUrl = useCallback((data: string) => {
    if (isValidUrl(data)) {
      window.open(data, "_blank", "noopener");
    }
  }, []);

  const handleCopyHistoryItem = useCallback(
    async (data: string) => {
      const result = await copyToClipboard(data);
      notify(result.success ? HISTORY_COPIED_MESSAGE : COPY_FAILED_MESSAGE, {
        tone: result.success ? "info" : "error",
      });
    },
    [copyToClipboard, notify]
  );

  const handleDeleteItem = useCallback(
    (id: string) => {
      removeItem(id);
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
    setPaused((prev) => !prev);
  }, []);

  // Copy the generator's input text, reusing the clipboard + notification hooks.
  const handleCopyGenerator = useCallback(
    async (data: string) => {
      const result = await copyToClipboard(data);
      notify(result.success ? COPY_SUCCESS_MESSAGE : COPY_FAILED_MESSAGE, {
      tone: result.success ? "info" : "error",
    });
    },
    [copyToClipboard, notify]
  );

  // Keyboard shortcuts using useKeyboardShortcuts hook
  const shortcuts = useMemo(
    () => [
      {
        key: "c",
        handler: () => scannedData && handleCopyCurrent(),
      },
      {
        key: "o",
        handler: () => handleOpenUrl(scannedData),
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
      // Never fire app shortcuts while focus is in a text field, button,
      // select, or rich-text host — typing "c" or space in the generator
      // textarea must not copy/toggle the camera, and tabbing to a Copy/Open
      // URL/Pause button must not fire its shortcut either.
      if (shouldIgnoreShortcut(e.target)) return;
      // Shortcuts act on the Scan tab's scannedData only.
      if (activeTab !== "scan") return;
      handleKeyDown(e);
    };

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [handleKeyDown, showClearConfirm, activeTab]);

  const deviceConstraints = useMemo(
    () => ({ facingMode: "environment" as const }),
    []
  );

  // Camera is paused whenever the user paused it OR the Create tab is active.
  // Composing here (not CSS-hiding) stops the stream so no Camera access denied
  // banner leaks when the app boots on Create with permission already granted.
  const scannerPaused = paused || activeTab !== "scan";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Header />

        <ModeTabs activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === "scan" && (
          <div id="panel-scan">
            <QRScanner
            paused={scannerPaused}
            onScan={handleScan}
            onError={handleError}
            deviceConstraints={deviceConstraints}
            onToggle={toggleScanner}
            imageBusy={imageBusy}
            imageStatus={imageStatus}
            onImageFile={handleImageFile}
            onImagePasteClick={handleImagePasteClick}
          />
          </div>
        )}

        {activeTab === "create" && (
          <div id="panel-create">
            <QrGenerator
              text={gen.text}
              result={gen.result}
              onChange={gen.setText}
              onCopy={handleCopyGenerator}
            />
          </div>
        )}

        <Notification message={notification} tone={notificationTone} />

        <ScanHistory
          history={history}
          expandedItems={expandedItems}
          onCopyHistoryItem={handleCopyHistoryItem}
          onToggleExpand={toggleExpand}
          onDeleteItem={handleDeleteItem}
          onOpenUrl={handleOpenUrl}
          onClearHistory={() => setShowClearConfirm(true)}
          isValidUrl={isValidUrl}
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
