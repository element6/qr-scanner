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
  ├── ScanHistory                              latest decode + actions, clear history
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
`BarcodeDetector`, spec §7.1) is the sole new dependency. Its wasm binary is
**not** fetched from a CDN at runtime any more: it is self-hosted for offline use
— see "PWA / offline" below. The Scan tab's copy budget is exactly two button
labels + the status line; `Notification` unchanged. The former `LastScan` panel
was removed because `addToHistory` already prepends the newest decode to
`ScanHistory`, so the two showed the same value; its Open URL action moved onto
the history rows and its Clear history button into the `ScanHistory` header. No
camera/settings changes; history stays source-less (`from image` provenance
deferred).

## PWA / offline

The app is installable and runs with no network. `vite-plugin-pwa` (devDep)
drives Workbox `generateSW`; `registerType: "autoUpdate"` emits a `sw.js` that
calls `skipWaiting()` + `clientsClaim()`, so a new build takes over on the next
reload with no update prompt.

```
build (docs/)
  ├── sw.js                     Workbox precache + navigation fallback
  ├── manifest.webmanifest      generated from `manifest` in vite.config.ts
  ├── icons/                    icon.svg + maskable source → 192/512 PNGs
  ├── zxing/zxing_reader.wasm   self-hosted (offline-critical)
  └── assets/                   hashed JS/CSS
```

| Piece | Decision |
|-------|----------|
| Manifest | Generated by the plugin from the `manifest` option and linked into `index.html` at build time. The hand-written link pointed at a root `manifest.json` that Vite never copied into `docs/`, so production referenced a file that did not exist; that dead file was deleted. All base-dependent values (`id`, `start_url`, `scope`) derive from `BASE` rather than being hardcoded, or `build:local` emits a manifest scoped to a path it is not served from. |
| Base | `BASE` in `vite.config.ts` is derived from Vite's `mode` (`--mode root` → `/`, otherwise `/qr-scanner/`) and is the single source of truth: the Vite `base`, the manifest's base-dependent fields, and the SW's `navigateFallbackDenylist` regex all derive from it, and `index.html` uses `%BASE_URL%`. It deliberately does **not** come from a `--base` CLI flag, which overrides Vite's `base` while leaving these values stale — the bug that made `build:local` emit a manifest scoped to `/qr-scanner/`. The denylist is built with `new RegExp` because a literal `/qr-scanner/` pattern silently matches nothing at another base. |
| Wasm drift guard | `scripts/check-wasm.mjs` (`bun run check:wasm`, which CI runs before the build) hashes the committed binary and compares it against the version's own exported `ZXING_WASM_SHA256`. Nothing else ties the committed wasm to the installed package, so a `zxing-wasm` bump that refreshes `node_modules` without re-running the copy leaves a stale binary — breaking image scanning **offline only**, with no build error. |
| Registration | A plain `navigator.serviceWorker.register()` in `src/main.tsx`, **not** `virtual:pwa-register`. That helper dynamically imports `workbox-window`, a chunk Vite emits *after* Workbox has built its precache manifest — so it is never precached and its `import()` rejects with `ERR_INTERNET_DISCONNECTED` on every offline start. Nothing is lost: `autoUpdate` already self-activates the new SW. |
| Precache scope | Shell (`index.html`, hashed JS/CSS), `manifest.webmanifest`, icons, favicon, and the wasm (~1 MiB, hence `maximumFileSizeToCacheInBytes` raised to 8 MiB). `sw.js` and the Workbox runtime are deliberately excluded from the precache, or the browser could never fetch a new service worker. Icons come from `includeAssets` and the wasm from the `wasm` glob — listing either in both places created duplicate precache entries. |
| Navigation | Single-view SPA: `navigateFallback: "index.html"` for in-scope navigation, with `/qr-scanner/assets/` denylisted so a missing asset 404s instead of silently returning the shell. |
| Offline image scan | The load-bearing fix. `zxing-wasm`'s default Emscripten `locateFile` downloads every binary from `fastly.jsdelivr.net` at runtime, so with only the shell cached, image-file scanning — and nothing else — fails offline. `public/zxing/zxing_reader.wasm` is committed from `node_modules/zxing-wasm/dist/reader/` and `src/utils/scanImage.ts` registers `setZXingModuleOverrides({ locateFile })` at module load, before the lazy `getDetector()` can construct a detector. `resolveWasmPath(file, base)` is pure and unit-tested; the base comes from `import.meta.env.BASE_URL` so the path survives the `/qr-scanner/` deploy sub-path. Only the *reader* variant is vendored (encoding uses the pure-JS `qrcode`), and any other variant falls back to the CDN. |
| Dev | `devOptions.enabled: false` — a service worker in `dev` would mask real dev-server behavior. PWA behavior is verified against `build` + `preview` (`vite preview`), which is why `npm run preview` is documented in the README. |

`localStorage` history is untouched by any of this: it is same-origin storage, not
a network resource, and is already the reason history survives a reload.
