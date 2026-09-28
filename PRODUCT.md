# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: the owner, plus a small known circle (team, family, or people at a
gathering) — not an anonymous public audience. They reach it by opening the
GitHub Pages link and either using it in the browser or installing it; there is
no account, invite, or onboarding funnel, and no plan to add one.

Their situation is ad hoc and in-the-moment: a QR code or barcode is physically
present (on a screen, a label, a package, a document, or a photo file), and they
need its content now — on whichever device is at hand, phone or desktop.

Job to be done: turn a QR/barcode into usable text, and pass that text onward
(copy it, open it as a URL), without sending the content anywhere.

## Product Purpose

A QR/barcode tool that runs entirely in the browser, with two directions:

- **Scan** — decode a QR/barcode from the camera or from an image file.
- **Create** — encode text into a QR code.

Scan results are kept in a local history so recent content can be re-copied or
re-opened without re-scanning.

Success means: someone with a code in front of them gets the content in seconds,
on any device, with the network off if necessary, and never has to wonder where
their scanned data went.

## Positioning

Privacy is the product's mechanism, not a slogan: decoding, encoding, and
history all happen on the device. There is no server call carrying scanned
content, no upload, and no telemetry — which is also why the app can run
correctly with the network fully disabled. A neighboring "online QR scanner"
that posts images to a backend could not truthfully make the same claim.

The second, structural consequence of that same choice: image-file scanning
works offline, because the decoding WebAssembly binary is vendored into the
build rather than fetched from a CDN.

## Operating Context

- Delivered as a static site on GitHub Pages under base `/qr-scanner/`, via
  GitHub Actions. There is no backend and no runtime server component.
- Installable as a PWA; after one online visit it reloads and works with the
  network disabled (an installed icon is the expected long-term usage, but
  in-browser use is equally supported).
- Used on both phones (camera is the natural input) and desktops (webcam or an
  image file is the natural input — a phone's native camera app cannot serve
  this case).
- History lives in `localStorage` under `qrScanHistory`, capped at 50 items;
  the active tab persists under `qr-scanner-tab`.
- Development and verification are local: `npm run dev`, `npm run build` +
  `npm run preview`, `npm run test:run`, `npm run typecheck`, `npm run
  check:wasm`.

## Capabilities and Constraints

Confirmed functionality:

- Camera scanning and image-file scanning (single image, pasted clipboard image,
  and a file picker), including more than one code in a frame.
- QR generation from text, exported as SVG, error-correction level `M`, up to
  2,331 bytes.
- Local scan history: copy an item, open a valid URL from it, delete one item,
  clear all (with confirmation).
- Keyboard shortcuts as a shipped desktop affordance (`c` copy, `o` open URL,
  space toggles scanning), suppressed while typing in a field.

Binding constraints:

- **Client-side only.** No server calls, no telemetry, no analytics; scanned
  content must never leave the device. Any feature that would ship data
  off-device is out of bounds for this product.
- **Offline-first installability is load-bearing, not decorative.** Two details
  guard it and must not be "simplified" away: the vendored
  `public/zxing/zxing_reader.wasm` (verified by `npm run check:wasm` in CI) and
  the plain `navigator.serviceWorker.register()` in `src/main.tsx` instead of
  the `virtual:pwa-register` helper.
- **Deployment base stays `/qr-scanner/` on GitHub Pages.** `BASE` in
  `vite.config.ts` is the single source of truth for the Vite base, the
  manifest's `id`/`start_url`/`scope`, and the service-worker denylist; it must
  not be replaced by a `--base` CLI flag.
- Stack is fixed: Vite + React 19 + TypeScript + Tailwind CSS 4, deployed as
  static assets.

Explicitly undecided: history currently caps at 50 items and lives only in
`localStorage` (no sync, no export) — whether that stays the ceiling is an open
product question, not a settled one. No accessibility standard has been chosen
(see below). Whether `qrScanHistory` should ever be exportable is undecided.

## Brand Commitments

- Product name for anything user-facing (page title, PWA title, installed name):
  **Code Scanner**. The repository, package, and deployment path remain
  `qr-scanner`; the shorter installed iOS title is "Scanner". These are
  currently inconsistent — the user-facing name above is the binding one.
- Voice already in the product: plain, short, non-technical status messages
  ("Scan saved to history", "Copied latest scan to clipboard"). No marketing
  language, no exclamation, no emoji.
- No logo, wordmark, color, typography, or visual-world commitment has been
  made; nothing visual is binding yet.

## Evidence on Hand

- Working implementation: `src/App.tsx` and `src/components/*` (scanner,
  generator, history, mode tabs, notifications), `src/hooks/*`,
  `src/utils/*`.
- Behaviour specs: `specs/scan-image-from-file.md`, `specs/encode-text-to-qr.md`,
  and a prototype at `specs/prototype-scan-image.html`.
- Operational truth: `README.md` (PWA/offline mechanics, base handling, icon
  regeneration), `architecture.md`, `REPO_SUMMARY.md`.
- Test suite: 71 tests across 5 files (Vitest) — `src/utils/*.test.ts`,
  `src/components/*.test.ts`.
- Real icons exist: `public/icons/icon.svg`, `icon-maskable.svg`, and rendered
  PNGs at 192/512.
- No user research, testimonials, case studies, benchmarks, or usage metrics
  exist. Future work must not fabricate them — and no privacy policy, terms, or
  legal text is on hand either.

## Product Principles

1. **The content stays on the device.** Every feature decision is bounded by
   "does scanned data leave this machine?" If it would, it does not belong here.
2. **No network is a supported state, not a degraded one.** Offline behaviour is
   part of the contract and is guarded by CI, not left to chance.
3. **A code in hand becomes usable text in seconds.** Any step that delays the
   decode-to-copy path (setup, permission friction, extra taps) is a defect.
4. **The same tool on every device.** Phone and desktop are equally first-class
   inputs; do not optimize one into a second-class experience.
5. **Static and dependency-light by design.** No backend, no account system, no
   third-party services that would make the privacy claim conditional.
