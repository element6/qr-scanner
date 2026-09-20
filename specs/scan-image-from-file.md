# Spec: Scan a QR code from an image (upload or paste)

**Status:** Draft for review — 4 of 5 open questions resolved (§10), 1 remains
**Author:** agent (spec-anything)
**Date:** 2026-09-10
**App version:** qr-scanner 0.0.0 (`src/App.tsx` 209 lines, scan + create tabs shipped in `218e8d5`)

---

## 1. Problem

The only way to get a QR code into this app is a live camera. `src/components/QRScanner.tsx`
wraps `@yudiel/react-qr-scanner`'s `Scanner`, which drives a `<video>` stream. So:

- A QR code that exists as a file — a screenshot in Downloads, an image in a chat, a
  PDF export, someone's shared link — cannot be read without a second phone or a second
  monitor to point the camera at.
- On a desktop with no camera at all, the app is unusable: `paused` starts as `true`
  (`App.tsx:53`) and the only path to a value is `onScan` from the video pipeline.

Every decode primitive for the file case is already installed. `@yudiel/react-qr-scanner`
depends on `barcode-detector@3.0.8`, whose `BarcodeDetector.detect()` accepts
`Blob | ImageData | ImageBitmap | SVGImageElement | VideoFrame`
(`node_modules/barcode-detector/dist/es/utils.d.ts:4`) and returns objects carrying
`rawValue: string` (`.../es/core.d.ts:12`) — the same field the camera path reads at
`App.tsx:89`. The gap is UI and plumbing, not capability.

## 2. Proposed solution

Add an **image input** to the Scan tab, beside the camera, that feeds the existing result
pipeline. Three ways in, one path out:

```
file picker ─┐
drag & drop  ─┼→ validate → BarcodeDetector.detect(blob) → rawValue → applyDetectedValue()
paste (⌘V)   ─┘                                                      (= today's handleScan tail)
```

The decoded value lands in `scannedData`, the `ScanHistory` list, and `useHistory` exactly as a
camera scan does. No new dependency, no second result model, no change to the Create tab.

## 3. User stories

- As a desktop user, I press ⌘V on a screenshot of a QR code and the value appears at
  the top of Scan History, so I never need a camera.
- As a user, I drag an image from my file manager onto the camera frame and it decodes,
  so I don't hunt for an "Upload" button.
- As a user, when an image has no code in it I get told *"No code found in this image"*
  (not "no QR code" — an Aztec or PDF417 in the same screenshot *would* decode) — not
  silence, not a crash, and my camera keeps running.
- As a user on the Create tab typing into the textarea, ⌘V still pastes text and never
  triggers an image scan.
- As a keyboard/screen-reader user, "Upload image" is a real focusable button with a
  visible status announcement, so this feature is not mouse-only.

## 4. Scope

### 4.1 In scope

| ID | Requirement |
|----|-------------|
| R1 | Compact one-row image control on the Scan tab, next to the Start/Pause row: a **Choose image…** button opening a hidden `<input type="file" accept="image/*">` and a **Paste** button. Multi-file selection ignored (first file only). Strict copy budget (§7.7): two button labels + the status line — no descriptive paragraph, no format list in the UI. |
| R2 | Drag-and-drop onto the camera frame: `dragover` adds a visible highlight, `drop` decodes the first image item. Flicker-proof via an **enter/leave counter** (`dragenter`++ / `dragleave`-- / clear at zero, reset on `drop`) — a naive `dragleave` handler strobes because it fires when the pointer crosses any child element. While the Scan tab is mounted, **document-level `dragover`/`drop` handlers call `preventDefault()` unconditionally** so a drop outside the frame cannot navigate the SPA away to the raw file; files are handled only when the event target is inside the frame. |
| R3 | Clipboard paste, **two paths**: (a) desktop — a `paste` listener decoding `clipboardData.files[0]` when it is an image, ignoring plain-text pastes, mounted only while the Scan tab is shown; (b) touch — the **Paste** button reads `navigator.clipboard.read()` and decodes the first `image/*` `ClipboardItem`. If the async Clipboard API is missing or denied, the status line says so and the file picker remains the fallback. |
| R4 | Decode via `barcode-detector` (already in the tree) on the `File` blob, restricted to **matrix codes**: `formats: ["matrix_codes"]`, the library's input aggregate for exactly Aztec, DataMatrix, MaxiCode, PDF417, QRCode, MicroQRCode, rMQRCode (the `"M"` tier in `ponyfill.js`; linear codes are excluded). Results still come back with a concrete `format`. No new npm dependency. |
| R5 | Validation before decode: non-image MIME/type, size cap (20 MB), zero-byte file, and an undecodable image each produce a specific message and never reach the decoder. |
| R6 | Feedback states on the control: idle → `Decoding…` → success (reuses `Notification` + `ScanHistory`) or a visible error line. The control is disabled while decoding. The status element carries `role="status"` (`aria-live="polite"`) so state changes are announced, not merely visible (§3 a11y story, AC13). |
| R7 | Result routing: decoded value goes through one shared `applyDetectedValue(value, source, count?)` in `App`, so camera and image scans write state identically. |
| R8 | Multiple codes in one image: the first result with a non-empty `rawValue` wins; if `count > 1` the notification appends the count. |
| R9 | History: an image scan is stored like a camera scan; `ScanHistory` gains a `from image` affordance only if it is a one-line addition to the existing item — otherwise deferred (§4.2). |
| R10 | Unit tests for the pure parts (§7.6) under the existing vitest config. |

### 4.2 Out of scope

- **Scanning a QR *generated* in the Create tab into history** — the tabs stay independent.
- **Source provenance in history** (`camera` vs `image`) — needs a `HistoryItem` type change
  and a migration of stored `qrScanHistory` records. Deferred.
- **PDF / multi-page / archive input.** Only raster images the browser can decode.
- **Batch mode** (pick 20 files, decode all).
- **Multi-frame or live-camera-image parity** — no `allowMultiple` for the camera.
- **Camera settings changes** — formats, torch, zoom, constraints untouched.
- **Any network call, analytics, or "image quality" scoring.**
- **Editing the image before decode** (crop, rotate, contrast) as *user-facing tools*.
  Invisible decode-input normalization (the §7.3 `createImageBitmap` resize/orientation
  preprocess) is explicitly **in** scope — it is not an edit the user sees or controls.

## 5. Acceptance criteria

| ID | Given / When / Then |
|----|--------------------|
| AC1 | Given a valid QR PNG, when I choose it via the button, then within one user-perceptible beat the newest `ScanHistory` row shows its `rawValue`, `notify` fires, and `addScan` recorded it exactly once. |
| AC2 | Given a screenshot in the clipboard, when I press ⌘V with focus on `<body>` on the Scan tab, then the image decodes and behaves as AC1. |
| AC3 | Given an image with no code, when decoded, then the status line reads "No code found in this image", the camera state (`paused`) is unchanged, and nothing is written to history. |
| AC4 | Given focus is inside the Create textarea, when I paste text, then no decode is attempted and the text inserts normally. |
| AC5 | Given a `.txt` or a 25 MB file, when selected, then a specific message is shown, `detect` is never called, and the input is cleared so the same file can be re-picked. |
| AC6 | Given an image containing two QR codes, when decoded, then the first non-empty-`rawValue` result is applied and the notification mentions 2 codes. |
| AC7 | Given a decode in flight, when I drop or paste a second image, then the second is ignored (no overlapping decodes, no double history entry). |
| AC8 | Given a successful image scan, when I switch to Create and back, then no stale "Decoding…" state remains (the component unmounted; state lives in `App` or is reset on mount). |
| AC9 | Given a fake detector factory that throws at construction (wasm init failure), when `scanImageFile` runs, then it resolves `{ok:false,kind:"decode-failed"}`, the message renders, and no uncaught error escapes. |
| AC10 | `pnpm build` succeeds; `pnpm test` passes; no change to `vite.config.ts` base (`/qr-scanner/`) so GitHub Pages routing is unaffected. |
| AC11 | Given a touch device with no keyboard, when I tap **Paste**, then the clipboard image is decoded (or the status line explains that clipboard access is unavailable), and when I tap **Choose image…** the OS picker opens. Neither path requires a drag gesture or ⌘V. |
| AC12 | Given the rendered control, when measured, then it is one row of two buttons plus one status line: no paragraph text, no format list (R1's copy budget, §7.7). |
| AC13 | Given the rendered control, when inspected, then the status element carries `role="status"`, is **always mounted** (empty text at idle, per §7.3 — live regions absent from the DOM miss their first announcement), and transitions update its text. Verification method in §7.6. |

## 6. Success metrics

Not measured in code. Proxies for "is this worth its UI weight":

- A user with no working camera can complete a scan end to end (demoable in Safari
  private mode with camera denied — the error card from `handleError` shows and the image
  path still works).
- Time from "I have a QR screenshot" to "value in history" ≤ 2 interactions
  (paste, or click→pick).
- No regression in the camera path: existing shortcut set (`c`, `o`, `space`, `?`) and
  history behaviour unchanged.

## 7. Technical approach

### 7.1 Dependency decision — reuse `barcode-detector`, do not add a package

`@yudiel/react-qr-scanner@2.5.1` declares `barcode-detector@3.0.8` as a **dependency**
(not peer), and the app is decode-only through it today. Two options:

| Option | Cost | Risk |
|--------|------|------|
| **A. Import `barcode-detector` directly (recommended)** | Zero new packages; same ZXing wasm the camera already loads; result shape already matches (`rawValue`). | It is a transitive dep, so it is unpinned by our `package.json`. A future `@yudiel` bump could move it. |
| B. Add `zxing-wasm` (or `jsqr`) as our own dep | Explicit contract, version we control. | A second decoder wasm in the bundle, ~the same engine twice, and a diverging result type. |

Mitigation for A, required: **add `barcode-detector` to `dependencies` in `package.json`
at the version already resolved** so the import is a declared contract rather than an
accident of hoisting. (Do not upgrade it — bumping changes the camera path too.)

Import path matters: `barcode-detector` root entry executes `import "./polyfill.js"`
(`dist/es/index.d.ts:1`), which installs a global `window.BarcodeDetector`. Import
`barcode-detector/ponyfill` instead — the class without the global side effect, leaving
the camera library's own detection untouched.

**Known typing gap:** the *exported* `ponyfill.d.ts` declares
`detect(): Promise<DetectedBarcode[]>` against a local `DetectedBarcode` that lists only
`cornerPoints`, while the full interface (`boundingBox`, `rawValue`, `format`,
`cornerPoints`) lives in `core.d.ts`, which is **not** in the package `exports` map. So
`results[0].rawValue` is a type error on the public import path. Do not "fix" the library
and do not deep-import `dist/es/core.js` — declare the minimal local type in our wrapper
(§7.3) and cast once, at the boundary.

### 7.2 Files touched

| File | Change |
|------|--------|
| `src/utils/scanImage.ts` | **new.** Pure validation + decode wrapper. No React. |
| `src/utils/scanImage.test.ts` | **new.** Vitest tests for validation and result mapping (the decode call is injected). |
| `src/components/ImageScanControl.tsx` | **new.** Button + hidden file input + drag/drop + paste listener + status line. Presentational; owns no app data. |
| `src/components/index.ts` | barrel export for `ImageScanControl`. |
| `src/components/QRScanner.tsx` | render `ImageScanControl` in the card footer; accept `onImageScan` + `imageStatus` props; add drag-highlight classes. |
| `src/App.tsx` | extract `applyDetectedValue` from `handleScan`; hold `imageStatus` state; pass handlers down. |
| `package.json` | declare `barcode-detector` at the resolved version. |
| `architecture.md` | add the image path to the component tree + module table (per repo hygiene rule). |
| `wip.md` | create during implementation; delete in the feature commit (repo §3). |

No changes to: `useHistory`, `useClipboard`, `useQrCode`, `ModeTabs`, `QrGenerator`,
`ScanHistory`, `validators.ts`, `vite.config.ts`, `vitest.config.ts`.

### 7.3 Interfaces

```ts
// src/utils/scanImage.ts
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ScanFailure =
  | { ok: false; kind: "not-image"; name: string }
  | { ok: false; kind: "too-large"; name: string; bytes: number }
  | { ok: false; kind: "empty"; name: string }
  | { ok: false; kind: "undecodable"; name: string }
  | { ok: false; kind: "not-found"; name: string }        // decoded, no symbol present
  | { ok: false; kind: "decode-failed"; name: string };   // detector ctor threw / wasm init failed

/** Produced by the Paste button path only — never by `scanImageFile` (Round-1 B4/R3). */
export type ClipboardFailure =
  | { kind: "clipboard-denied" }       // read() threw NotAllowedError (iOS: Settings ▸ Safari ▸ Clipboard)
  | { kind: "clipboard-unavailable" }  // navigator.clipboard?.read absent (non-secure context)
  | { kind: "clipboard-empty" };       // readable, but no image/* item

export type ScanSuccess = { ok: true; value: string; count: number };
export type ScanOutcome = ScanSuccess | ScanFailure;

/** No side effects; returns a failure without touching the decoder. Empty `file.type`
 *  is rescued by a whitelisted extension (§8). */
export function validateImageFile(file: File | null | undefined): ScanFailure | null;

/** Messages only — the one place image-scan copy is defined, so the UI cannot drift.
 *  Strings are normative; see the table in §7.7 (Round-1 Q3). */
export function describeOutcome(o: ScanOutcome | ClipboardFailure): string;

/** Pure result mapping; testable without wasm. First result with a NON-EMPTY
 *  `rawValue` wins; all empty → `not-found` (Round-1 R4). */
export function toOutcome(
  results: Array<{ rawValue: string }>,
  name: string
): ScanOutcome;

/** The only impure function. Owns the detector instance lazily and never leaks it.
 *  Preprocesses through `createImageBitmap(blob, { imageOrientation: "from-image",
 *  longest side ≤ 2048 })` and detects on the bitmap; `bitmap.close()` in a finally —
 *  no native-bitmap leak. On `not-found` retries once with the raw blob so tiny codes
 *  in huge photos survive (Round-1 Alt-1), **except** when the source is >40 MP:
 *  the retry leg is skipped there (an unbounded full-res decode is exactly the
 *  lockout Alt-1 closed; a code that small in a photo that big is not worth
 *  seconds of UI lockout). First leg bounded by construction, retry leg bounded
 *  by the pixel threshold — no timeout race needed. */
export function scanImageFile(file: File): Promise<ScanOutcome>;
```

```tsx
// src/components/ImageScanControl.tsx
type ImageScanControlProps = {
  busy: boolean;
  status: string | null;          // describeOutcome() text; null at idle → element stays
                                  // mounted with empty text (live regions absent from the
                                  // DOM don't announce their first change — Round-2 Risk 4)
  onFile: (file: File | null) => void;   // picker + drop funnel here
  onPasteClick: () => void;              // Paste button; App owns clipboard.read() (R3b)
};
```

`ImageScanControl` attaches `paste` on `document` inside its `useEffect` and removes it on
cleanup, so the listener exists exactly while the Scan tab is mounted.

```ts
// src/App.tsx (new shared tail; handleScan becomes a thin caller)
const applyDetectedValue = useCallback(
  (value: string, source: "camera" | "image", count?: number) => {
    /* setScannedData, addScan, notify — notify composes " — 2 codes found"
       suffix when count > 1 (R8/AC6; Round-1 B2). */
  },
  [scannedData, addScan, notify],
);
```

Dedupe inside it is **source-aware** (Round-1 B1, resolves OQ2): camera keeps the existing
`nextValue === scannedData` early return (silent, no history row). For `"image"`, a repeat
value notifies "Already the latest scan" and writes **no** history row — one behavior,
matching §8.

### 7.4 State / data flow

- `App` owns `imageStatus: { busy: boolean; message: string | null }` — **not** the control,
  so a tab switch cannot strand a "Decoding…" label (AC8).
- `onDetectedFile(file)`: `validateImageFile` → if failure, set `imageStatus.message`
  (inline only — **no toast for failures**, Round-1 Q4) and return; else set `busy`,
  `await scanImageFile`, map through `describeOutcome`.
- Success calls `applyDetectedValue(value, "image", count)` — which, per §7.5, must **not**
  touch `paused`. **Guard:** ignore new input while `busy` (AC7), and reset `busy` in a
  `finally` so a throwing decode cannot wedge the UI. Decode time is bounded by the ≤2048px
  preprocess (§7.3), so no timeout race is needed.
- Paste button: `await navigator.clipboard.read()` in `App`; each rejection class maps to a
  distinct `ClipboardFailure` kind with its own string (§7.7 table); no image item →
  `clipboard-empty`. All three are inline status only (Q4).
- Reset the hidden `<input>`'s `value` to `""` after every pick so re-selecting the same
  file still fires `change` (AC5).
- Never call `URL.createObjectURL` — the `File` is already a `Blob` and the decoder takes a
  `Blob`, so there is no object URL to revoke. Fewer leak surfaces.

### 7.5 Camera interaction rules

- **Decided (2026-09-10):** an image scan **does not change `paused`.** The camera pauses
  itself on success (`App.tsx:91`) because it just caught the code it was looking for; a
  file decode says nothing about the camera's job. This is the one intentional behaviour
  difference between the two paths, and `applyDetectedValue` must therefore take a
  `source` parameter and pause only for `"camera"`.
- Decoding runs off the main thread inside the wasm worker; it will not starve the video
  loop. If a file is dropped while the camera is denied or erroring, the image path is
  unaffected — its only dependency is the decoder.

### 7.6 Tests

The environment constrains this: `vitest.config.ts` includes **only** `src/**/*.test.ts`,
and no React testing library is installed. So test the logic, not the DOM:

- `validateImageFile`: `image/png` ok; `text/plain` → `not-image`; `""` type with `.png`
  name → **valid** (§8 empty-MIME rescue row); `""` type with `.txt` name → `not-image`;
  21 MB → `too-large`; 0 bytes → `empty`.
- `toOutcome`: `[]` → `not-found`; one result → `{ok:true,value,count:1}`; two results →
  `count:2` and the **first non-empty** `rawValue` wins (two results, first `""` → value
  from second, per Round-1 R4); all empty → `not-found` (mirrors `App.tsx`'s empty-value
  guard).
- `describeOutcome`: one assertion per `kind`, including the three `ClipboardFailure`
  kinds, so copy changes fail loudly. Strings asserted against the §7.7 table.
- `scanImageFile`: inject a fake detector factory; assert `decode-failed` when the
  constructor throws and `undecodable` when `detect()` throws. No real wasm in jsdom.
- AC13: no React testing library exists, so `role="status"` is verified by a string match
  on the component source (`ImageScanControl.tsx` must contain `role="status"` and must
  **not** conditionally unmount the status element) plus a manual check on the built page:
  first announcement after idle must be read by VoiceOver.

### 7.7 Copy budget & the Paste button (from viewer feedback, 2026-09-10)

First mock was annotated *"too verbose, also need a button to paste from clipboard for
mobile."* Fixes are normative:

- **Nothing to explain.** The control renders `Choose image…` + `Paste` as two buttons on
  one row next to Start/Pause, and the status line below. Deleted: the "Scan from an image"
  heading, the "Drop an image…" sentence, and the matrix-formats paragraph. Drag-and-drop
  is discovered, not described (R2); supported formats are not listed in the UI — the
  failure string already tells the truth.
- **Paste must be a button, not only ⌘V.** Touch devices have no clipboard chord; the
  button is the only mobile path besides the picker. It calls
  `navigator.clipboard.read()`, picks the first `image/*` item, `getType()` → `Blob`, and
  funnels into the same `onFile` handler. Every rejection class maps to its own
  `ClipboardFailure` kind and string (§7.3, §7.7 table) — never a silent no-op (AC11).
- If the status line needs to explain drag-and-drop, the copy failed — cut it instead.

**Normative strings** (`describeOutcome` output — Round-1 Q3; tests assert exactly these,
and the last column is the delivery channel per Q4):

| Kind | String | Channel |
|------|--------|---------|
| `too-large` | `Image is too large (20 MB max)` | inline |
| `not-image` | `That file isn't an image` | inline |
| `empty` | `That file is empty` | inline |
| `undecodable` | `Couldn't read that image — try a PNG or JPEG` | inline |
| `not-found` | `No code found in this image` | inline |
| `decode-failed` | `Scanner failed to start — reload the page` | inline |
| `clipboard-denied` | `Clipboard blocked — allow it in browser settings, or choose a file` | inline |
| `clipboard-unavailable` | `Clipboard not available here — choose a file instead` | inline |
| `clipboard-empty` | `No image on the clipboard` | inline |
| success | `Scanned <value>` (+ ` — N codes found` when count > 1) | toast |
| repeat (image) | `Already the latest scan` | toast |

All user-facing strings say "code", never "QR code" (§10 Q4). Failure copy is exempt from
the "nothing to explain" rule — a short truth beats a paragraph.

## 8. Edge cases & error handling

| Case | Behaviour |
|------|-----------|
| Clipboard has text only (AC4) | `files` is empty → return silently, no toast. The textarea keeps working. |
| Clipboard has an image (`File`/`ClipboardItem`) | Handled via `clipboardData.files[0]`. If `files` is empty but `items` has an `image/*` kind, `getAsFile()` it. |
| Empty `file.type` (some file managers / Android browsers) | Rescue by extension: `.png .jpg .jpeg .gif .webp .bmp` → valid; otherwise → `not-image`. (`validateImageFile` test asserts both.) |
| HEIC from an iPhone | Browser cannot decode it → `undecodable` message, not a hang. Do not add a converter. |
| SVG upload | The ponyfill type admits `SVGImageElement`, but rasterising SVG for decode is unreliable and cross-origin-tainted. Treat `image/svg+xml` as `not-image`. |
| EXIF orientation / mirrored screenshot | **Resolved by preprocess (§7.3):** `createImageBitmap(..., {imageOrientation:"from-image"})` applies orientation in every modern browser (ponyfill's own `createImageBitmap(blob)` call at `ponyfill.js:1922` gets the same default). Mirrored images still report `not-found`; do not silently flip. |
| Very large dimensions (e.g. 8000×8000) within 20 MB | Downscaled to ≤2048px longest side before decode (Round-1 Alt-1), so wasm time is bounded; full-res retry only on `not-found`. No timeout needed. |
| Same value as the current `scannedData` | **Resolved (OQ2):** camera dedupe unchanged (silent). Image path: notify "Already the latest scan" and **write no history row** — history stays a set; §7.3 source-aware dedupe implements this. |
| Decoder wasm fails to fetch (offline, GH Pages path) | `scanImageFile` catch → `decode-failed` + `console.error`, mirroring `handleError`'s pattern (`App.tsx:100`). |
| User drops a directory | `items` entry has `kind:"file"` but is not a `File` with an image type → `not-image`. |
| Drop outside the frame / on the Create tab | Scan tab mounted: document-level `preventDefault` kills navigation everywhere (R2). **Create tab:** control unmounted, so a dropped image *does* navigate the browser to the raw file — pre-existing SPA behavior, out of scope; do not claim otherwise. |
| Repeated ⌘V of the same image | `busy` guard, then the dedupe rule above. |

## 9. Rollout / migration

- Purely additive UI on an existing tab. No storage key changes, no data migration,
  no removal of any existing capability.
- Ship in one commit on `main` behind no flag; the control is small enough that
  "is this discoverable" is answered by looking at it, not by a kill switch.
- No new dependency to bundle beyond the already-resolved `barcode-detector`. Take a
  `pnpm build` baseline **before** the change and compare after (Round-1 R5): **fail the
  PR if `dist/` grows by more than 200 KB or a second `zxing-wasm` chunk appears** —
  either means the import specifier differs from `@yudiel`'s and the wasm got duplicated;
  resolve to one module instance before shipping. Note the delta in the commit body.
- **Known limitation to state in the README** (currently one line): very low-contrast or
  blurred images may report "no code found"; use the camera for those. (EXIF orientation
  is no longer a limitation — the §7.3 preprocess applies it.)

## 10. Open questions

**Resolved by the requester on 2026-09-10:**

- ~~Q1 (camera pause)~~ → **No, the camera keeps running.** Written into §7.5 and §7.4 as a
  hard requirement: `applyDetectedValue` pauses only for `source: "camera"`.
- ~~Q4 (formats)~~ → **All matrix codes.** Written into R4 as `formats: ["matrix_codes"]`.
  Note the consequence: a screenshot holding a Data Matrix now decodes, so every
  user-facing string must say "code", not "QR code" (§3, AC3, §8) — the app is named
  "Code Scanner" in `manifest.json`, which happens to fit.
- ~~OQ1 (where paste/upload attach)~~ → **Resolved with the Round-1 review (consul B7):**
  Scan tab only, camera card footer (R1–R3). Reopened only if AC4 fails in testing.
- ~~Q2 (repeat value from an image)~~ → **Resolved with the Round-1 review (consul B1):**
  notify "Already the latest scan", **no** history row. Source-aware dedupe in §7.3; §8
  is the single normative behavior statement.

**Still open — answer before implementation:**

1. **History provenance tag** (`from image`, R9) is deferred to §4.2. Confirm that is
   acceptable, since it is the only place a user could tell the two sources apart after the
   fact.
