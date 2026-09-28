"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Notification,
  QRScanner,
  ScanResult,
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
  useCameraStatus,
} from "./hooks";
import { buildGoogleSearchUrl, isValidUrl } from "./utils/validators";
import { derivePrimaryAction } from "./utils/cameraStatus";
import { shouldIgnoreShortcut } from "./utils/keyboardGuard";
import { describeOutcome, readClipboardImage, scanImageFile } from "./utils/scanImage";

// Shortcut notification messages as constants
const SHORTCUT_HELP_MESSAGE =
  "Shortcuts: c=copy, o=open URL, space=toggle scan";
const SCAN_SAVED_MESSAGE = "Scan saved to history";
const SCAN_COPIED_MESSAGE = "Scanned — copied to clipboard";
// An undoable toast must outlive the 2200 ms default so the action is reachable.
const UNDO_DURATION_MS = 6000;
const HISTORY_RESTORED_MESSAGE = "History item restored";
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
  // Whether the user asked to scan again after a decode: the Scan panel is
  // result-first, so a decode swaps the viewport for `ScanResult` and only this
  // flag brings the camera back. Cleared on every new decode (below).
  const [viewportReopened, setViewportReopened] = useState(false);
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
  // Camera truth comes from the stream, not from `paused`: the badge and the
  // primary button are derived from these values (F1).
  const {
    status: cameraStatus,
    issue: cameraIssue,
    beginRequest,
    retry,
    handleCameraError,
    attachFrame,
  } = useCameraStatus();

  // Camera is paused whenever the user paused it OR the Create tab is active.
  // Composing here (not CSS-hiding) stops the stream so no Camera access denied
  // banner leaks when the app boots on Create with permission already granted.
  // Derived above its readers because a callback's dependency array is
  // evaluated where the callback is declared, not where it is called.
  const scannerPaused = paused || activeTab !== "scan";

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

  // Snapshot of the last single-row delete, so the toast can offer Undo. Holding
  // the value (not just the id) means restore works without reading `history`.
  const [pendingUndo, setPendingUndo] = useState<string | null>(null);

  // The snapshot is only valid while its own toast is on screen. Toast expiry
  // clears the message, and any other notification replaces it — either way the
  // pending value is stale, and without this it could restore the wrong item or
  // resurrect one into a history the user just emptied.
  useEffect(() => {
    if (notification !== HISTORY_DELETED_MESSAGE) {
      setPendingUndo(null);
    }
  }, [notification]);

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
        // A fresh decode always takes the panel back to result-first, so a
        // viewport reopened earlier does not swallow the new payload. This is
        // the shared tail, so camera and image scans behave identically.
        setViewportReopened(false);
        setPaused(true);
        addScan(value);
        // Confirming the copy is what the user actually wants (usable text);
        // history is the fallback message when the clipboard is unavailable.
        void copyToClipboard(value).then((result) => {
          notify(result.success ? SCAN_COPIED_MESSAGE : SCAN_SAVED_MESSAGE);
        });
        return;
      }
      if (value === scannedData) {
        notify("Already the latest scan");
        return;
      }
      setScannedData(value);
      setViewportReopened(false);
      addScan(value);
      const suffix = count !== undefined && count > 1 ? ` — ${count} codes found` : "";
      // The payload itself is on screen in the result surface, so the toast only
      // confirms the outcome. Interpolating the value here put an unbounded
      // string in a single-line live region: a 200-char code widened the
      // document to 1603px on a 1024px canvas.
      notify(`Scanned${suffix}`);
    },
    [scannedData, addScan, copyToClipboard, notify]
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

  /** Raw exception text never reaches the UI: it is unreadable, and for a
   *  blocked camera the state panel already says what to do about it. The hook
   *  decides whether the payload is a camera failure at all — the library's
   *  `onError` also carries decode and worker errors. */
  const handleError = useCallback(
    (err: unknown) => {
      console.error("Scanner error:", err);
      handleCameraError(err);
    },
    [handleCameraError]
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

  // Non-URL counterpart to `handleOpenUrl`, offered by each history row. The row
  // only surfaces it for non-empty, non-URL values; `buildGoogleSearchUrl`
  // returns "" for a blank query, which keeps a whitespace-only payload from
  // opening an empty results page.
  const handleSearchWeb = useCallback((data: string) => {
    const url = buildGoogleSearchUrl(data);
    if (!url) return;
    window.open(url, "_blank", "noopener");
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
      const target = history.find((item) => item.id === id);
      removeItem(id);
      // Single-row delete is immediate, so it carries the undo affordance the
      // bulk clear already had behind its modal.
      if (target) {
        setPendingUndo(target.data);
        notify(HISTORY_DELETED_MESSAGE, { duration: UNDO_DURATION_MS });
        return;
      }
      setPendingUndo(null);
      notify(HISTORY_DELETED_MESSAGE);
    },
    [history, removeItem, notify]
  );

  const handleUndoDelete = useCallback(() => {
    if (pendingUndo === null) return;
    addScan(pendingUndo);
    setPendingUndo(null);
    notify(HISTORY_RESTORED_MESSAGE);
  }, [pendingUndo, addScan, notify]);

  const handleConfirmClear = useCallback(() => {
    clearHistory();
    notify(HISTORY_CLEARED_MESSAGE);
    setShowClearConfirm(false);
  }, [clearHistory, notify]);

  /** One entry point for the primary button and the space shortcut: what the
   *  camera should do next is derived from stream status, so a camera that never
   *  opened offers a retry instead of repeating the action that just failed. */
  const toggleScanner = useCallback(() => {
    const action = derivePrimaryAction(cameraStatus, scannerPaused);
    if (action.kind === "pause") {
      setPaused(true);
      return;
    }
    if (action.kind === "start") {
      setPaused(false);
      beginRequest();
      return;
    }
    if (action.kind === "retry") {
      setPaused(false);
      retry();
    }
    // "none" is the un-clickable Starting… state; nothing to do.
  }, [cameraStatus, scannerPaused, beginRequest, retry]);

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

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl lg:max-w-5xl">
        {/* Mobile stacks in reading order (tabs → privacy → panel → notification
         *  → history); at lg the tabs and the on-device promise span both
         *  columns, and the active panel and Scan History sit side by side so
         *  their cards start on the same line. DOM order is the mobile order. */}
        <div className="space-y-6">
          <ModeTabs activeTab={activeTab} onChange={setActiveTab} />

          <p className="text-center text-sm text-slate-500">
            Runs on your device. Works offline; history stays in this browser and
            keeps the last 50 scans.
          </p>
        </div>

        <div className="mt-6 space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-6">

        {activeTab === "scan" && (
          <div id="panel-scan">
            {/* Result-first: a decode replaces the viewport with the payload it
             *  found. `viewportReopened` is the user asking for the camera
             *  back, not a camera state. */}
            {scannedData && !viewportReopened ? (
              <ScanResult
                value={scannedData}
                canOpen={isValidUrl(scannedData)}
                onCopy={handleCopyCurrent}
                onOpen={() => handleOpenUrl(scannedData)}
                onScanAnother={() => {
                  setViewportReopened(true);
                  setPaused(false);
                }}
              />
            ) : (
            <QRScanner
            paused={scannerPaused}
            status={cameraStatus}
            issue={cameraIssue}
            onScan={handleScan}
            onError={handleError}
            deviceConstraints={deviceConstraints}
            onPrimaryAction={toggleScanner}
            attachFrame={attachFrame}
            imageBusy={imageBusy}
            imageStatus={imageStatus}
            onImageFile={handleImageFile}
            onImagePasteClick={handleImagePasteClick}
          />
            )}
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

        <Notification
          message={notification}
          tone={notificationTone}
          action={
            notification === HISTORY_DELETED_MESSAGE && pendingUndo !== null
              ? { label: "Undo", onClick: handleUndoDelete }
              : undefined
          }
        />
        </div>

        <ScanHistory
          history={history}
          expandedItems={expandedItems}
          onCopyHistoryItem={handleCopyHistoryItem}
          onToggleExpand={toggleExpand}
          onDeleteItem={handleDeleteItem}
          onOpenUrl={handleOpenUrl}
          onSearchWeb={handleSearchWeb}
          onClearHistory={() => setShowClearConfirm(true)}
          isValidUrl={isValidUrl}
        />
        </div>

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
