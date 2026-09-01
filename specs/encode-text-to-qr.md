# Spec: Encode text → QR code

**Status:** Draft for review
**Author:** agent (spec-anything)
**Date:** 2026-09-01
**App version:** qr-scanner 0.0.0 (`src/App.tsx`, 209 lines)

---

## 1. Problem

The app is decode-only. `src/components/QRScanner.tsx` wraps `@yudiel/react-qr-scanner`
(`Scanner`) and writes results into `useHistory`. There is no way to produce a QR code.

That leaves an obvious user loop open: someone who wants to hand a URL, a Wi-Fi
password, or a chunk of text to another person's phone has no tool here, even though
the same page already holds camera permission, the clipboard hook, and persisted
history. The app is named "Code Scanner" (`manifest.json`) and README is a single
heading — both describe a reader. This feature makes it a QR tool, not just a reader.

## 2. Proposed solution

Add a second primary mode to the existing page. A **Scan | Create** tab switch at the
top of the main column toggles between the camera scanner (today's UI, unchanged) and
a generator: a text area plus a live-rendered QR symbol. Encoding is done client-side
by the `qrcode` npm package; rendering is SVG, so the preview scales without a canvas
and no image download plumbing is required in v1.

Generator content is the mirror image of what the scanner decodes. Anything the
scanner can put in history, the generator can put back on screen.

## 3. User stories

- As a user, I type a URL into the Create tab and see its QR code immediately, so I can
  hold my laptop screen up to a phone.
- As a user, I paste a very long text and get told it will not fit in one QR symbol, so I
  don't stare at a code that will never scan.
- As a user, I switch from Create back to Scan and the camera does not restart
  mid-frame or leak a `Camera access denied` error on an empty view.
- As a user, my tab choice survives a reload, so a returning user who lives in Create
  mode does not re-pick it.

## 4. Scope

### 4.1 In scope

| ID | Requirement |
|----|-------------|
| R1 | Tab control (`Scan` / `Create`) in the main column, keyboard accessible, `aria-selected`/`role="tab"`. Default tab is `Scan`. |
| R2 | Multi-line text input. Empty input renders an inline placeholder message, not an error. |
| R3 | Live QR render of the current text, debounced ~150 ms after the last keystroke. |
| R4 | Encoder: `qrcode`'s **`toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })`** — in the browser build that is the *only* SVG entry point (`toDataURL` is bound to the canvas renderer and returns PNG). Result wrapped as a `data:image/svg+xml;base64,` URL for an `<img>`, sized at 100% panel width with `max-width` so modules stay ≥ 4 px. |
| R5 | Capacity handling: the encoder is the authority on "too long" (it knows the mode it picked). On failure, show a message naming the byte-mode limit (2,331 for `M`) and keep the previous valid code on screen. A live byte readout warns from 2,331 bytes up, but must not block rendering above it. |
| R6 | Pure encoder wrapper and capacity helper in `src/utils/`, unit-tested with vitest, in the style of `src/utils/validators.ts`. |
| R7 | Scanner paused whenever the Create tab is active (camera stream stopped, not just hidden). |
| R8 | Copy-the-input-text button in the Create panel, reusing `useClipboard` and `useNotification`. |
| R9 | Persisted tab choice in `localStorage`, validated on read, falling back to `scan`. |

### 4.2 Out of scope

| Excluded | Why |
|----------|-----|
| PNG / SVG file download | User declined for v1 (live screen render only). Note: an **SVG** download is cheap now — `<a download>` around the existing data URL. A **PNG** download needs the canvas path (`toDataURL`, which is the only place the browser build touches pngjs-free canvas rendering) plus a scale control for print. If v2 revisits this, start with SVG. |
| Wi-Fi, vCard, SMS, email structured forms | Requires per-schema field validation and escaping (`\`, `;`, `,`, `"`). Free text + URL covers the loop the scanner already closes. |
| Custom colors, logo overlay, error-correction selector | Cosmetic; adds dependency surface (`qr-code-styling`) and print-readability risk. |
| Saving generated codes into scan history | `HistoryItem` is `{ data, timestamp }` (`src/utils/validators.ts`) with no direction field; adding one is a storage-schema migration with a back-compat path. Separate spec. |
| Server-side or Node encoding | App is a static Vite build published to `docs/` in CI. |
| Batch generation, vCard contacts import, print sheets | Different feature entirely. |
| Router / separate `/generate` route | User chose tabs in one page. Adding react-router to a 2-view app is unjustified. |

## 5. Acceptance criteria

- [ ] **Given** the Create tab is open and the text area is empty, **when** the panel renders, **then** the message "Enter text to generate a QR code" is shown and no `<img>` is present.
- [ ] **Given** `https://example.com` is typed, **when** rendering settles, **then** an `<img>` whose `src` starts with `data:image/svg+xml` is in the DOM and the panel shows the byte count of the input.
- [ ] **Given** a 2,953-byte mixed-case ASCII string, **when** encoding is attempted, **then** the encoder refuses and a warning names the 2,331-byte `M` limit; the last valid code stays on screen.
- [ ] **Given** a 2,331-byte string, **when** encoded, **then** the symbol renders (EC `M`, byte mode, version 40).
- [ ] **Given** a 5,000-digit numeric string (over byte-mode capacity, under numeric-mode capacity), **when** encoded, **then** a code renders rather than being pre-rejected by a byte threshold.
- [ ] **Given** an emoji string (e.g. `🙂🙂`), **when** encoded, **then** it renders and the capacity check counted 8 bytes, not 2 characters.
- [ ] **Given** the user types 200 characters with pauses < 150 ms, **when** watching encoder calls, **then** at most one encode happens after the final keystroke.
- [ ] **Given** a valid code is on screen, **when** the user switches to Scan, **then** `paused === true` was passed to `Scanner` (video track ended), and **when** they switch back to Create, **then** the input text is still present.
- [ ] **Given** camera permission was granted, **when** the user reloads on the Create tab, **then** no `Camera access denied` / `NotAllowedError` error banner appears (the scanner never started).
- [ ] **Given** localStorage holds `{"activeTab": 42}`, **when** the app boots, **then** tab falls back to `Scan` with no console error.
- [ ] **Given** the generated code is on screen, **when** scanned by a second phone at normal reading distance, **then** it decodes to the exact input string (manual check, recorded in the PR).
- [ ] `bun run test:run` passes, including new encoder/util tests.
- [ ] `bun run build` succeeds and the Create tab works from the built `docs/` output (GitHub Pages base path `/qr-scanner/`).
- [ ] `bun run build` bundle contains no Node-only `fs` shim from `qrcode` (grep the emitted JS).
- [ ] `architecture.md` is created in the same commit as the implementation — none exists in this repo, and the repo rules require one before component boundaries change.

## 6. Success metrics

Design targets — no telemetry exists and none will be added for this:

- Round-trip: 100% of ASCII strings ≤ 2,331 bytes and ≥ 95% of multibyte strings scan on the first attempt on two phones (one Android, one iOS).
- Zero regressions in scanner behaviour: existing keyboard shortcuts (`c`, `o`, space, `?`, Escape) and history persistence work identically on the Scan tab.
- No visible input lag: keystroke-to-paint stays under 16 ms while typing (work is deferred by the debounce).

## 7. Technical approach

### 7.1 Dependency decision — use `qrcode`, do not hand-roll

| Option | Size | Risk |
|--------|------|------|
| **`qrcode` 1.5.4 + `@types/qrcode` 1.5.6** (chosen) | ~135 KB unpacked lib; browser build gzips small; tree-shaken by Vite | Low. Maintained MIT package, byte/numeric/alphanumeric/kanji auto-segmentation, SVG + canvas + terminal renderers. |
| `qr-code-styling` | ~2× larger | Styling surface we do not need in v1; pulls in its own encoder fork. |
| Hand-rolled encoder | 0 KB | Must implement Galois-field Reed–Solomon, mode segmentation, 8 mask patterns + penalty scoring, format/version info. Hundreds of lines, and a wrong mask or EC block produces a code that *looks* fine and never scans. |

`qrcode`'s package.json declares a `browser` field mapping `./lib/index.js` → `./lib/browser.js`
and stubbing `fs`, so the bundler picks the browser build; no Node-only `fs`/`pngjs` code reaches
the client as long as we import from the package root and use `qrcode/lib/browser`-safe APIs
(`toString` with `type: 'svg'`). Verified against `lib/browser.js` on master: `toDataURL` → canvas/PNG, `toString` → `renderer/svg-tag.js`. Do not reach for `toDataURL` to get SVG — that is a Node-build-only option and silently yields PNG here. Also verify the built bundle contains no `fs`/`pngjs`/`yargs` shim.
There is no tsconfig in this repo — Vite/esbuild strips types without checking — so
`@types/qrcode` is for editor/agent correctness only, not a build gate.

### 7.2 Files touched

```
package.json                                 R  add qrcode (dep), @types/qrcode (devDep)
src/utils/qrcode.ts                          N  encoder wrapper + capacity helpers (pure)
src/utils/qrcode.test.ts                     N  vitest unit tests for above
src/hooks/useQrCode.ts                       N  debounced text → { dataUrl, error, byteLength }
src/components/QrGenerator.tsx               N  textarea, byte readout, <img> preview, copy btn
src/components/ModeTabs.tsx                  N  Scan | Create role="tablist"
src/components/index.ts                      M  re-export the two new components
src/hooks/index.ts                           M  re-export useQrCode
src/App.tsx                                  M  activeTab state, tab render, scanner pause wiring
src/hooks/useHistory.ts                      M  localStorage key → { history, activeTab } (only if R9 reuses the same key)
```

Two ways to satisfy R9; pick one during implementation, do not invent a third:

- **(a)** one namespaced key `qr-scanner-storage` holding `{ history, activeTab }` — mirrors
  `STORAGE_KEY` in `useHistory.ts`, but requires touching that hook's read/write path.
- **(b)** a separate `qr-scanner-tab` key read/written by a tiny `useActiveTab` — zero changes
  to `useHistory.ts`. Smaller blast radius; chosen unless the user objects.

### 7.3 Interfaces

```ts
// src/utils/qrcode.ts — pure, no React, no DOM
export type QrErrorCode = "empty" | "too-long" | "encode-failed";
export interface QrEncodeResult {
  ok: boolean;
  dataUrl?: string;      // "data:image/svg+xml;base64,..." — ready for <img src>
  error?: QrErrorCode;   // "too-long" only when the encoder itself refuses
  message?: string;      // user-facing; app copy is English, so no i18n layer in v1
  byteLength: number;    // UTF-8 byte length, via TextEncoder — for the readout
}
export const QR_ERROR_CORRECTION = "M" as const;   // single constant, no selector in v1
export const BYTE_MODE_MAX_BYTES = 2331;           // EC M byte-mode capacity, for messaging only
export function utf8ByteLength(s: string): number;
export function encodeQrSvg(text: string): Promise<QrEncodeResult>;
```

No `maxPayloadBytes()`-style pre-flight gate: mode selection belongs to the encoder, and a
byte-length threshold would wrongly reject numeric/alphanumeric payloads (see §8).

```ts
// src/hooks/useQrCode.ts
export interface UseQrCode {
  text: string;
  setText: (t: string) => void;
  result: QrEncodeResult | null;
  pending: boolean;      // true between keystroke and debounce fire
}
export function useQrCode(delayMs?: number): UseQrCode;   // default 150
```

```tsx
// src/components/QrGenerator.tsx
type QrGeneratorProps = {
  onCopy: (data: string) => void;   // App wires to handleCopyHistoryItem-style handler
};
```

`QrGenerator` owns no app state; text lives in the hook instance created in `App.tsx` so the
value survives tab switches (the component unmounts when Scan is active).

### 7.4 State / data flow

```
App.tsx
  activeTab: "scan" | "create"        useState + localStorage (key qr-scanner-tab)
  gen = useQrCode()                   text, debounced encode
    │
    ├── create: ModeTabs(activeTab, onChange)
    ├── scan  : QRScanner(paused = pausedByUser || activeTab !== "scan", ...)
    └── create: QrGenerator(result=gen.result, text=gen.text, onChange=gen.setText, onCopy)
```

The scanner's existing `paused` state stays untouched as the *user's* pause toggle; tab
visibility is composed with it (`||`). This is the one subtle interaction in the feature:
`@yudiel/react-qr-scanner` releases its `MediaStreamTrack` when `paused` flips true, and
re-requests the camera on resume. Without this, hiding the tab with CSS would leave the
camera light on.

### 7.5 Rendering

`encodeQrSvg` returns SVG markup from `toString`; the base64 wrapper happens in `src/utils/qrcode.ts`, not the component. `QrGenerator` renders it as
`<img src={dataUrl} alt={"QR code for: " + text}>`, where `dataUrl` is
`"data:image/svg+xml;base64," + btoa(svgString)`. No `dangerouslySetInnerHTML`, so the XSS
surface stays zero regardless of what the encoder emits. Inline markup was the alternative
(keeps an `<svg>` node to query in tests) but buys nothing: assert on the `img`'s `src`
prefix instead. The `alt` text carries the payload so screen readers get something
meaningful — without it the main artifact of the tab is invisible to assistive tech.

## 8. Edge cases & error handling

| Case | Behaviour |
|------|-----------|
| **Pure-numeric / uppercase-alphanumeric input** | The 2,331-byte figure is *byte-mode* capacity. `qrcode` auto-selects the densest mode, so digits fit 5,596 chars and `[0-9A-Z $%*+-./:]` fits 3,391 at `M`. Guard must therefore be: try to encode, and only report "too long" when the encoder itself fails — `utf8ByteLength` is for the readout and for a soft heads-up above 2,331 bytes, never for hard rejection. Pre-flight rejection is a known-wrong shortcut. |
| Empty input | Placeholder card, no encode call, no error tone. |
| Whitespace-only input | Treated as content (whitespace is encodable), code renders. Do not silently trim — a trimmed code misleads the user. |
| Input over EC-`M` byte-mode capacity (> 2,331 bytes, mixed-case) | Encoder refuses → warning naming the numeric limit; last valid code retained; copy button still copies the text. |
| Text between 2,331 and 2,953 bytes | Too long in byte mode at `M`, but may still encode when the payload is numeric (≤ 5,596) or uppercase-alphanumeric (≤ 3,391). Render whatever succeeds; the byte readout stays visible as a soft warning above 2,331. Lowering EC to `L` would fit more — mentioned in the message, not offered as a control (§4.2). |
| Multibyte/emoji | Byte length via `TextEncoder`, never `string.length`. QR renders; a phone may render the payload per its own decoder. |
| NUL, control chars, lone surrogates | Passed through to the encoder; if `qrcode` throws, map to `encode-failed` with "Could not generate a code for this text." Never crash the tab. |
| Very long single token (no spaces) | No wrapping issue: the symbol is a fixed square; the textarea scrolls. |
| Encoder throws (async) | Caught in `encodeQrSvg` (`QRCode.create` rejects synchronously-thrown capacity errors in promise mode), returned as `ok:false`. No unhandled rejection. |
| Non-ASCII payload vs `btoa` | Safe: the SVG string contains only tags and numbers — user bytes become module coordinates, never markup. But `btoa` throws on any code point > 255, so assert in the unit test that the encoded string is pure ASCII before relying on it. |
| Rapid tab switching during the debounce window | Cancel the pending timer on unmount/`setText` supersession; never write state after unmount. |
| Camera denied + user on Create tab | No banner: `Scanner` never mounts while another tab is active. |
| `paused === true` from user toggle while on Scan, then tab switch | On returning to Scan, the scanner is still paused by the user's own choice — do not auto-resume. |
| localStorage unavailable (private mode / quota) | `try/catch` both read and write; fall back to in-memory default `scan`, matching how `useHistory` already tolerates failures. |
| Copy of generated text on insecure origin | `useClipboard` falls back to `execCommand`; existing behaviour, no new code. |
| Narrow viewport (320 px) | Tabs stack above the panel; SVG is `width:100%` with `max-width: 320px`, so no horizontal overflow. |
| Print / zoom | SVG scales; acceptable up to panel `max-width`. |

## 9. Rollout / migration

- Static GitHub Pages build, no server, no feature flag, no staged rollout surface. Ship behind
  nothing; the default tab remains `Scan`, so existing users see the identical first paint with one
  new tab control above the scanner.
- No storage migration in the chosen design (R9 option b uses a new key). Existing
  `qr-scanner-storage` history is untouched, so no user loses scans.
- Rollback = revert the commit; nothing persists that a revert strands (an orphan
  `qr-scanner-tab` key is ignored by old code).

## 10. Open questions

1. **Tab persistence** (R9): worth the code at all for a two-button choice, or drop it and keep
   every visit starting on Scan? Currently spec'd in, easily cut.
2. **Download PNG (v2)**: is a code you can only photograph off a screen good enough, or is
   "save it for the shop window" the real use? If the latter, v2 must add canvas rendering and a
   scale/quality control — that changes R4's SVG-only choice, so it is worth answering now.
3. **History round-trip**: should a generated code be recallable from history (needs the
   `HistoryItem` direction field)? Deferred above; confirm nobody wants it before v1 ships.
4. **Copy target**: R8 copies the *input text*. Is "copy the image" expected? Clipboard image
   write needs `ClipboardItem` + canvas — assumed no, flagging because the app's copy shortcut
   is the most-used affordance today.
5. **EC level**: `M` is assumed (good scan reliability, standard default). If the target is small
   printed labels, `Q`/`H` trade capacity for robustness differently — needs a product call, not
   a technical one.
