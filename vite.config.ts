import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The deploy base is derived from Vite's `mode`, and is the single source of
 * truth for every base-dependent value below.
 *
 * It must NOT come from a `--base` CLI flag: that overrides Vite's own `base`
 * while leaving these values untouched, so `build:local --base /` produced a
 * manifest still declaring `/qr-scanner/`. Vite knows the mode here, so the
 * config, the manifest, the service worker and `%BASE_URL%` in index.html can
 * never disagree.
 *
 * The mode is named `root`, not `local` — Vite rejects `local` as a mode name
 * because it collides with its own `.env.local` postfix convention.
 */
export default defineConfig(({ mode }) => {
  const BASE = mode === "root" ? "/" : "/qr-scanner/";
  // Escaped so the regex is safe for any base, including one with `.` or `-`.
  const escapedBase = BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return {
    base: BASE,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // A stateless utility with no server state: a new build should take over
        // on the next load rather than leave a stale shell cached behind a prompt.
        registerType: "autoUpdate",
        // Registration is explicit in `src/main.tsx` (a plain
        // `navigator.serviceWorker.register`) so it is greppable, its timing is
        // visible, and no `workbox-window` chunk is pulled in — see that file.
        injectRegister: null,
        // `includeAssets` covers what `globPatterns` deliberately excludes. The
        // wasm is *not* listed here: the `wasm` glob already picks it up, and
        // naming it in both places produced a duplicate precache entry.
        includeAssets: ["vite.svg", "icons/*.png"],
        manifest: {
          id: BASE,
          name: "Code Scanner",
          short_name: "Scanner",
          description:
            "Scan QR codes with the camera or from an image file, and generate your own — works offline.",
          // Directory index, not `/index.html`: keeps start_url inside `scope`.
          start_url: BASE,
          scope: BASE,
          display: "standalone",
          theme_color: "#3498db",
          background_color: "#ffffff",
          icons: [
            // Relative: manifest URLs resolve against the manifest's own URL,
            // so these stay correct under any base without interpolation.
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          categories: ["utilities", "productivity"],
        },
        workbox: {
          // `wasm` is the point of this list: the vendored reader binary must be
          // precached or image scanning is the one feature that dies offline.
          // Deliberately no `png`/`svg` here — the icons and favicon come from
          // `includeAssets`, and listing them twice produced duplicate entries.
          globPatterns: ["**/*.{js,css,html,wasm}"],
          // Always exported at the dist root; `sw.js` must never be precached or
          // the browser can never see a new service worker.
          globIgnores: ["**/sw.js", "**/workbox-*.js"],
          // Single-view SPA: every in-scope navigation resolves to the shell.
          navigateFallback: "index.html",
          // Derived from BASE — a literal /qr-scanner/ pattern silently matches
          // nothing at another base, disabling the asset carve-out.
          navigateFallbackDenylist: [new RegExp(`^${escapedBase}assets/`)],
          // The reader wasm is ~919 KiB, over Workbox's 2 MiB default ceiling
          // once combined; without this the build warns and silently skips it.
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
        // No service worker in `bun run dev` — it would serve a stale shell and
        // mask real dev-server behaviour. Verified with `build` + `preview`.
        devOptions: { enabled: false },
      }),
    ],
    build: {
      outDir: "docs",
    },
  };
});
