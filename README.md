# qr-scanner

QR code scanner webapp with camera access, scan history, and a QR encoder.

- **Scan** — decode QR/barcodes from the camera or an image file.
- **Create** — encode text to an SVG QR code (EC `M`, up to 2,331 bytes).
- Scan history persists in `localStorage` (`qrScanHistory`, max 50 items).

Built with Vite 8 + React 19 + Tailwind CSS 4. Deployed to GitHub Pages at
base `/qr-scanner/`.

## Progressive Web App (installable + offline)

The build ships a service worker that precaches the app shell, so the scanner
can be installed to the home screen / desktop and used with no network at all —
camera scanning, image-file scanning, QR generation and history all work
offline.

- Install: open the deployed site and use the browser's **Install** /
  **Add to Home Screen** action.
- Offline: after one online visit the app reloads and runs with the network
  disabled. History (`localStorage`) is unaffected.

### How offline works

`vite-plugin-pwa` (Workbox `generateSW`) precaches the built assets. Two details
are load-bearing:

1. **The zxing wasm is self-hosted.** `barcode-detector` → `zxing-wasm` downloads
   its WebAssembly binary from jsDelivr at runtime by default, which would make
   *image-file scanning* the one feature that fails offline even with the shell
   cached. `public/zxing/zxing_reader.wasm` is committed (from
   `node_modules/zxing-wasm/dist/reader/`) and wired up by overriding
   Emscripten's `locateFile` in `src/utils/scanImage.ts`. Only the *reader*
   variant is vendored; anything else falls back to the CDN. To refresh it after
   a `zxing-wasm` upgrade, copy the file again (the checksum must match the
   library's exported `ZXING_WASM_SHA256`):

   ```
   cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm public/zxing/
   ```

2. **Registration is a plain `navigator.serviceWorker.register()`** in
   `src/main.tsx`, not the plugin's `virtual:pwa-register` helper. That helper
   dynamically imports a `workbox-window` chunk which is emitted *after* Workbox
   computes its precache manifest, so the chunk is never precached and its
   import throws `ERR_INTERNET_DISCONNECTED` on every offline start. The
   generated `sw.js` already calls `skipWaiting()` + `clientsClaim()`
   (`registerType: "autoUpdate"`), so a new build activates on the next reload.

### Testing PWA behavior locally

The service worker is disabled in `dev`, so use a real build:

```
npm run build
npm run preview        # serves docs/ at http://localhost:4173/qr-scanner/
```

Then in DevTools → Application check the manifest and service worker, and use
Network → **Offline** + reload to confirm it starts with no network.

### Regenerating the icons

`public/icons/*.png` are rasterized from the two SVG sources (macOS `sips`):

```
cd public/icons
sips -s format png --resampleHeightWidth 512 512 icon.svg --out icon-512.png
sips -s format png --resampleHeightWidth 192 192 icon.svg --out icon-192.png
sips -s format png --resampleHeightWidth 512 512 icon-maskable.svg --out icon-maskable-512.png
```

`icon.svg` is the normal icon; `icon-maskable.svg` is the maskable variant
(full-bleed background, glyph inside Android's inner 80% safe zone).

## Scripts

```
npm run dev       # start the Vite dev server
npm run build     # build to docs/
npm run preview   # serve the built docs/ (needed to test the service worker)
npm run typecheck # tsc --noEmit
npm run test      # vitest (watch)
npm run test:run  # vitest (single run)
```