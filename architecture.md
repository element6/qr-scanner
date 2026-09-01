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
| `src/hooks/useQrCode.ts` | Debounced (default 150 ms) text → `{ text, setText, result, pending }`. Cancels the timer on unmount/superseding; never writes state after unmount. Text lives here so it survives tab switches. |
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