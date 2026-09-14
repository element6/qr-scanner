# qr-scanner — improvement backlog (ranked by value)

Review date: 2026-09-14 · method: 3 parallel deep-dive agents (UI/logic/infra) + manual re-verification of every Tier-1/2 claim against source. Tests: 71/71 pass (vitest 3.0.0, 5 files). `typecheck` added (`tsc --noEmit`).

Legend: ✅ verified against source · ⚠️ plausible, not independently reproduced

---

## 🔴 Tier 1 — real bugs users hit

- [x] **1. Duplicate history entries + identity bug** (✅) — fixed in f201668
  `addToHistory` (src/utils/validators.ts:84-89) never dedupes; App only dedupes against the latest scan (src/App.tsx:101-102, 110-116). Scan A → B → A = two identical rows. `history.indexOf(item)` (src/components/ScanHistory.tsx:58) matches by value, so delete/copy on the 2nd duplicate acts on the 1st; `key={timestamp}-{index}` (line 61) can collide.
  Fix: give each item a stable unique id at creation, key rows on it, pass the id through `onToggleExpand`/`onDeleteItem`.

- [x] **2. Generator keeps stale QR when text cleared** (✅) — fixed in f201668 (gate on `text === ""`, not `!result.ok` per spec §4.1 R5)
  `lastGood.current` (src/components/QrGenerator.tsx:38-43) is never reset — clearing the textarea keeps the previous QR visible forever; the "Enter text to generate a QR code" branch (105-108) is dead code.
  Fix (applied): `if (text === "") lastGood.current = null;` + `preview` returns null when empty; `useQrCode` also `setResult(null)` on empty (debounced). Rejected `if (!result?.ok)` variant — would destroy R5 persistence on transient errors.

- [x] **3. Shortcuts fire while a button has focus** (✅) — fixed in f201668 via `src/utils/keyboardGuard.ts`
  Guard (src/App.tsx:266-271 via `shouldIgnoreShortcut`) exempts only `input`/`textarea`. Keyboard-tab to Copy / Open URL / Pause / tab buttons, then `c`/`o`/space triggers copy/open/toggle.
  Fix (applied): `SHORTCUT_IGNORE_SELECTOR = "input, textarea, select, button, a[href], [contenteditable]:not([contenteditable='false'])"` + `target.closest(...)` containment check; extracted to `keyboardGuard.ts` (7 tests).

## 🟠 Tier 2 — infrastructure (silently shipping risk)

- [x] **4. Zero type-checking** (✅) — fixed: added `typescript@^5.6.3`, strict `tsconfig.json`, `typecheck` script
  No `tsconfig.json`, `typescript` not a dependency. Vite/esbuild strips types without checking.
  Fix: add `typescript` devDep + strict `tsconfig.json` + `typecheck` script (`tsc --noEmit`), run in CI.

- [x] **5. CI runs no tests** (✅) — fixed: added `bun run test:run` step, pinned `bun-version: 1.2.0`
  `.github/workflows/deploy.yml` builds + deploys but never executes the 50 tests that exist.
  Fix: add `bun test` (or `npm run test:run`) step before build; pin `bun-version`; consider cache.

- [x] **6. Service worker is dead and would fail install** (✅) — fixed: deleted `js/service-worker.js`
  `js/service-worker.js` is committed but never registered (no `serviceWorker` ref in src/, no registration in index.html); `ASSETS_TO_CACHE` references `/js/jsQR.min.js` and `/styles.css` which don't exist at the `/qr-scanner/` base — `cache.addAll` would reject.
  Fix: delete it + drop PWA framing, or wire via `vite-plugin-pwa` so hashed asset paths stay in sync.

- [x] **7. `preview:local` serves the wrong directory** (✅) — fixed: `npx serve dist` → `npx serve docs`
  vite outDir is `docs/` (vite.config.ts:9) but the script is `npx serve dist` (package.json:11) — `dist/` is gitignored and always empty.
  Fix: `npx serve docs`, or drop the script in favor of `vite preview`.

## 🟡 Tier 3 — product / robustness

- [x] **8. Notifications invisible to screen readers** (⚠️) — fixed: persistent `role="status" aria-live="polite"`
  `Notification` has no `role`/`aria-live` and unmounts (returns null) when empty; all copy/save/error feedback routes through it (App.tsx:319).
  Fix: mount a persistent `role="status" aria-live="polite"` region (ImageScanControl.tsx:106-112 already does it correctly).

- [x] **9. `aria-controls` points at nonexistent panels** (⚠️) — fixed: added `id="panel-scan"`/`id="panel-create"`
  ModeTabs.tsx:52 references `panel-scan`/`panel-create`; no such ids exist in App.tsx.
  Fix: add `id="panel-scan"` / `id="panel-create"` to the panel wrappers.

- [x] **10. localStorage write inside a state updater** (✅) — fixed: compute `updated` then `setHistory`+`saveToStorage` outside updater
  `saveToStorage` runs inside `setHistory` updaters (src/hooks/useHistory.ts:60-64, 75-79). Violates React purity; updaters can be replayed (StrictMode/concurrent).
  Fix: compute `updated` first, then `setHistory(updated)` and `saveToStorage(updated)` after.

- [x] **11. Weak history entry validation + destructive recovery** (⚠️) — fixed: non-empty `data` + `Date.parse(timestamp)` check, no `removeItem` wipe (⚠️)
  `isValidHistoryItem` accepts `{data:"", timestamp:"not-a-date"}`; corrupt entries survive into state. Any parse error removes the entire history key (useHistory.ts:38).
  Fix: validate non-empty data + parseable timestamp; cap loaded array to MAX_HISTORY; log rejected entries instead of wiping storage.

- [x] **12. Clipboard read bails on first image item's failure** (⚠️) — fixed: iterate all items/types, `lastFailure` only after exhaust
  `readClipboardImage` (src/utils/scanImage.ts:168-180) returns `clipboard-unavailable` on any `getType` rejection instead of trying the next item/type; never checks `item.kind`.
  Fix: iterate all items/types, collect first successful image blob; only fail after exhausting everything; distinguish NotAllowedError from transient failures.

## 🟢 Tier 4 — hygiene (cheap wins)

- [x] **13. Dead/misplaced deps** (✅) — fixed: `@vitejs/plugin-react` → devDeps, removed `autoprefixer`/`postcss`
  `autoprefixer` + `postcss` unused under Tailwind v4 (`@tailwindcss/vite` plugin); `@vitejs/plugin-react` in `dependencies` should be `devDependencies`.

- [x] **14. Docs stale / empty** (✅) — fixed: rewrote `README.md`, `REPO_SUMMARY.md` `tests: none` → vitest
  README.md is 13 bytes (`# qr-scanner`); REPO_SUMMARY.md YAML says `tests: none` / `linting: none` (stale — 3 vitest files exist).

- [x] **15. Unused hook returns** (⚠️) — fixed: removed `isLoading`/`maxHistory`/`pending`/`lastResult`/`clearResult`/`isExpanded`
  `isLoading`, `maxHistory` (useHistory), `pending` (useQrCode), `lastResult`, `clearResult` (useClipboard), `isExpanded` (useHistoryExpanded) — never consumed by any component.

- [x] **16. Misc hygiene** (✅) — fixed: `window.open(..., "_blank", "noopener")`, `architecture.md` `pending` removed
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