# Architecture

Single-page React app (Vite 8 + Tailwind 4, published to GitHub Pages at base
`/qr-scanner/`). No router: the whole app is one view with two primary modes
switched by a `Scan | Create` tab control at the top of the main column.

## Before this feature

```
main.tsx → App
  ├── Header
  ├── QRScanner (@yudiel/react-qr-scanner)     camera scan only
  ├── Notification
  ├── LastScan                                 latest decode + actions
  ├── ScanHistory                              persisted history list
  └── ClearConfirmModal
```

State lived in `App.tsx` (`scannedData`, `paused`, `error`, `showClearConfirm`)
and in `useHistory` (`qrScanHistory` localStorage key). Hooks `useClipboard`,
`useNotification`, `useKeyboardShortcuts` (all in `src/hooks/useClipboard.ts`)
were wired at the App level. There was no encoder and no way to produce a QR.

## After this feature

```
main.tsx → App
  ├── Header
  ├── ModeTabs (Scan | Create)                 NEW
  ├── QRScanner  (only on Scan tab)            composed pause
  ├── QrGenerator (only on Create tab)         NEW
  ├── Notification
  ├── LastScan
  ├── ScanHistory
  └── ClearConfirmModal
```

### New modules

| Module | Responsibility |
|--------|----------------|
| `src/utils/qrcode.ts` | Pure encoder wrapper. `encodeQrSvg(text)` calls `qrcode`'s browser build (`toString`, `type: "svg"`, EC `M`, margin 2) and wraps the SVG in a `data:image/svg+xml;base64,` URL via `btoa`. `utf8ByteLength` uses `TextEncoder`. `BYTE_MODE_MAX_BYTES = 2331` is messaging-only — the encoder is the authority on capacity. |
| `src/utils/qrcode.test.ts` | Vitest unit tests for the wrapper (empty, data-url prefix, 2,331-byte render, 2,953-byte refuse, 5,000-digit numeric render, emoji byte count, ASCII-only SVG). |
| `src/hooks/useQrCode.ts` | Debounced (default 150 ms) text → `{ text, setText, result }`. Cancels the timer on unmount/superseding; never writes state after unmount. Text lives here so it survives tab switches. |
| `src/components/ModeTabs.tsx` | Accessible `role="tablist"` segmented control: `Scan` / `Create`, arrow-key navigation, `aria-selected`. |
| `src/components/QrGenerator.tsx` | Presentational: textarea, byte readout, soft warning above 2,331 bytes, `<img>` preview (empty → placeholder, error → warning card, pending → "Generating…"), "Copy text" button. Owns no app state. |

### Data flow

- **Tab choice**: `App.activeTab` (`useState`, seeded from `localStorage` key
  `qr-scanner-tab`, validated on read, fallback `scan`, wrapped in try/catch).
  Written on every change. Deliberately a *separate* key from `qrScanHistory`
  so `useHistory.ts` is untouched.
- **Generator text**: `App` creates `useQrCode()` once; `QrGenerator` receives
  `text`, `result`, `onChange`, `onCopy` as props. When the user switches to
  Scan the component unmounts but the hook instance stays mounted in App, so
  the typed text is preserved.
- **Camera pause**: composed as `paused || activeTab !== "scan"` at the App
  level before passing to `QRScanner`. The user's `paused` toggle is untouched;
  switching to Create stops the stream (the library releases the
  `MediaStreamTrack` on `paused`), it is never just CSS-hidden.
- **Shortcuts**: the document-level keydown handler now ignores events whose
  target is an `INPUT`/`TEXTAREA`, and only acts when `activeTab === "scan"`,
  so typing `c` or space in the generator textarea cannot copy or toggle the
  camera. `QrGenerator`'s "Copy text" button calls `App.handleCopyGenerator`,
  which reuses `useClipboard` + `useNotification` with the existing
  `COPY_SUCCESS_MESSAGE` / `COPY_FAILED_MESSAGE` constants.

### Dependency

`qrcode` (dep) + `@types/qrcode` (devDep). The package's `browser` field maps
`lib/index.js` → `lib/browser.js` and stubs `fs`, so the browser build is
picked automatically. Only `toString` with `type: "svg"` is used — `toDataURL`
is the canvas/PNG path and must not be reached for SVG. The built `docs/`
bundle is grep-verified to contain no `fs`/`pngjs`/`yargs` shim.

### Out of scope (deliberately)

PNG/SVG file download, Wi-Fi/vCard/SMS structured forms, custom colors/logos,
saving generated codes into scan history (needs a `HistoryItem` direction
field = storage migration), server-side encoding, batch generation, and a
separate `/generate` route.
## Scan-from-image feature (specs/scan-image-from-file.md)

```
main.tsx → App
  ├── Header
  ├── ModeTabs (Scan | Create)
  ├── QRScanner  (only on Scan tab)            composed pause
  │     └── ImageScanControl                   NEW (footer row of the Scan card)
  ├── QrGenerator (only on Create tab)
  ├── Notification
  ├── LastScan
  ├── ScanHistory
  └── ClearConfirmModal
```

### New modules

| Module | Responsibility |
|--------|----------------|
| `src/utils/scanImage.ts` | Decode a matrix code from an image `File`. Pure parts — `validateImageFile` (R9 gates: empty, >20 MB, non-image), `toOutcome` (first non-empty `rawValue`; `count` from result length), `describeOutcome` (the one home for §7.7 normative strings, incl. clipboard kinds) — sit beside the one impure `scanImageFile` (preprocess `createImageBitmap` ≤ 2048 px EXIF-normalized, detect, retry raw once below the 40 MP budget, `bitmap.close()` on every path). `clipboardImageFromDataTransfer` (paste-event image) and `readClipboardImage` (Paste-button async Clipboard API) normalize the two R3 entry paths into the same funnel. |
| `src/utils/scanImage.test.ts` | Vitest unit tests under jsdom: validation order, size cap, extension fallback, outcome mapping, exact copy strings, bitmap-close and retry-budget behavior with an injected detector (no wasm). |
| `src/components/ImageScanControl.tsx` | Presentational row: **Choose image…** (hidden `<input type="file" accept="image/*">`) + **Paste** + always-mounted `role="status"` line; document-level paste (skips text fields, images only) and dragover/drop `preventDefault` so a stray drop cannot navigate the SPA. Props: `busy`, `status`, `onFile`, `onPasteClick`. |
| `src/components/QRScanner.tsx` | Owns the drag-highlight counter on the camera frame (`dragenter`++ / `dragleave`-- / `drop` reset) and forwards `onImageFile`; the image path never touches `paused` (§7.5). |
| `src/App.tsx` | `applyDetectedValue(value, source, count?)` is the single write tail for camera and image scans (source-aware dedupe: camera silent, image → "Already the latest scan" toast; count suffix "— N codes found"). `imageBusy`/`imageStatus` live in App so tab switches cannot strand "Decoding…" (AC8); `handleImageFile` guards overlap (AC7) and resets busy in `finally`. |

`barcode-detector` (ponyfill entry only — the root entry would install a global
`BarcodeDetector`, spec §7.1) is the sole new dependency; wasm/zxing load on
first use via Vite dynamic import, same pattern as `qrcode` above. The Scan tab's
copy budget is exactly two button labels + the status line; `LastScan` and
`Notification` unchanged. No camera/settings changes; history stays source-less
(`from image` provenance deferred).
