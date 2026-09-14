# qr-scanner — improvement backlog (ranked by value)

Review date: 2026-09-14 · method: 3 parallel deep-dive agents (UI/logic/infra) + manual re-verification of every Tier-1/2 claim against source. Tests: 50/50 pass. No typecheck exists, so none of these were caught by tooling.

Legend: ✅ verified against source · ⚠️ plausible, not independently reproduced

---

## 🔴 Tier 1 — real bugs users hit

- [ ] **1. Duplicate history entries + identity bug** (✅)
  `addToHistory` (src/utils/validators.ts:84-89) never dedupes; App only dedupes against the latest scan (src/App.tsx:101-102, 110-116). Scan A → B → A = two identical rows. `history.indexOf(item)` (src/components/ScanHistory.tsx:58) matches by value, so delete/copy on the 2nd duplicate acts on the 1st; `key={timestamp}-{index}` (line 61) can collide.
  Fix: give each item a stable unique id at creation, key rows on it, pass the id through `onToggleExpand`/`onDeleteItem`.

- [ ] **2. Generator keeps stale QR when text cleared** (✅)
  `lastGood.current` (src/components/QrGenerator.tsx:34-41) is never reset — clearing the textarea keeps the previous QR visible forever; the "Enter text to generate a QR code" branch (97-100) is dead code.
  Fix: `if (!result?.ok) lastGood.current = null;`.

- [ ] **3. Shortcuts fire while a button has focus** (✅)
  Guard (src/App.tsx:268-269) exempts only `input`/`textarea`. Keyboard-tab to Copy / Open URL / Pause / tab buttons, then `c`/`o`/space triggers copy/open/toggle.
  Fix: guard with `e.target.closest("input, textarea, [contenteditable]")`.

## 🟠 Tier 2 — infrastructure (silently shipping risk)

- [ ] **4. Zero type-checking** (✅)
  No `tsconfig.json`, `typescript` not a dependency. Vite/esbuild strips types without checking.
  Fix: add `typescript` devDep + strict `tsconfig.json` + `typecheck` script (`tsc --noEmit`), run in CI.

- [ ] **5. CI runs no tests** (✅)
  `.github/workflows/deploy.yml` builds + deploys but never executes the 50 tests that exist.
  Fix: add `bun test` (or `npm run test:run`) step before build; pin `bun-version`; consider cache.

- [ ] **6. Service worker is dead and would fail install** (✅)
  `js/service-worker.js` is committed but never registered (no `serviceWorker` ref in src/, no registration in index.html); `ASSETS_TO_CACHE` references `/js/jsQR.min.js` and `/styles.css` which don't exist at the `/qr-scanner/` base — `cache.addAll` would reject.
  Fix: delete it + drop PWA framing, or wire via `vite-plugin-pwa` so hashed asset paths stay in sync.

- [ ] **7. `preview:local` serves the wrong directory** (✅)
  vite outDir is `docs/` (vite.config.ts:9) but the script is `npx serve dist` (package.json:11) — `dist/` is gitignored and always empty.
  Fix: `npx serve docs`, or drop the script in favor of `vite preview`.

## 🟡 Tier 3 — product / robustness

- [ ] **8. Notifications invisible to screen readers** (⚠️)
  `Notification` has no `role`/`aria-live` and unmounts (returns null) when empty; all copy/save/error feedback routes through it (App.tsx:319).
  Fix: mount a persistent `role="status" aria-live="polite"` region (ImageScanControl.tsx:106-112 already does it correctly).

- [ ] **9. `aria-controls` points at nonexistent panels** (⚠️)
  ModeTabs.tsx:52 references `panel-scan`/`panel-create`; no such ids exist in App.tsx.
  Fix: add `id="panel-scan"` / `id="panel-create"` to the panel wrappers.

- [ ] **10. localStorage write inside a state updater** (✅)
  `saveToStorage` runs inside `setHistory` updaters (src/hooks/useHistory.ts:60-64, 75-79). Violates React purity; updaters can be replayed (StrictMode/concurrent).
  Fix: compute `updated` first, then `setHistory(updated)` and `saveToStorage(updated)` after.

- [ ] **11. Weak history entry validation + destructive recovery** (⚠️)
  `isValidHistoryItem` accepts `{data:"", timestamp:"not-a-date"}`; corrupt entries survive into state. Any parse error removes the entire history key (useHistory.ts:38).
  Fix: validate non-empty data + parseable timestamp; cap loaded array to MAX_HISTORY; log rejected entries instead of wiping storage.

- [ ] **12. Clipboard read bails on first image item's failure** (⚠️)
  `readClipboardImage` (src/utils/scanImage.ts:168-180) returns `clipboard-unavailable` on any `getType` rejection instead of trying the next item/type; never checks `item.kind`.
  Fix: iterate all items/types, collect first successful image blob; only fail after exhausting everything; distinguish NotAllowedError from transient failures.

## 🟢 Tier 4 — hygiene (cheap wins)

- [ ] **13. Dead/misplaced deps** (✅)
  `autoprefixer` + `postcss` unused under Tailwind v4 (`@tailwindcss/vite` plugin); `@vitejs/plugin-react` in `dependencies` should be `devDependencies`.

- [ ] **14. Docs stale / empty** (✅)
  README.md is 13 bytes (`# qr-scanner`); REPO_SUMMARY.md YAML says `tests: none` / `linting: none` (stale — 3 vitest files exist).

- [ ] **15. Unused hook returns** (⚠️)
  `isLoading`, `maxHistory` (useHistory), `pending` (useQrCode), `lastResult`, `clearResult` (useClipboard), `isExpanded` (useHistoryExpanded) — never consumed by any component.

- [ ] **16. Misc hygiene**
  `window.open` without `noopener` (App.tsx:194; low risk — http/https whitelist already blocks `javascript:`); architecture.md mode `-rw-------` (chmod 644); `.pnpm-store/` on disk not gitignored; `.DS_Store` files (root + src/) deletable.

---

## ✅ Disproved claims (do not implement)

- **"`matrix_codes` crashes Chrome's native BarcodeDetector"** — false. Image path imports `barcode-detector/ponyfill` (scanImage.ts:12) = fully self-contained wasm; `globalThis.BarcodeDetector` never referenced; constructor accepts `matrix_codes` (ponyfill.js:1759, 2003-2016).
- **"ImageBitmap double-close / `.close()` on a File"** — false. `isBitmap` set only after success (scanImage.ts:238); resize `finally` closes only `natural`; retry closes before re-decode (249-250); outer guard `if (isBitmap)` (265). Clean on every path. Real gap: this branch is untested under jsdom — add a stubbed-`createImageBitmap` test.
- **"`btoa` breaks on Unicode SVG"** — false risk. `qrcode` SVG output is module coordinates only (ASCII); user bytes never embedded as text.

## Quality gate (recommended before shipping)

- [ ] `typecheck` (tsc --noEmit) passes
- [ ] `vitest run` passes in CI
- [ ] Manual test: A→B→A scan history dedupe, clear-textarea preview, button-focus shortcuts