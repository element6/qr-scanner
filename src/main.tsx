import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA/offline: precache the app shell (and the vendored zxing wasm) so the
// scanner installs and reloads with no network.
//
// Deliberately a plain `register()` rather than the plugin's
// `virtual:pwa-register` helper. That helper dynamically imports
// `workbox-window`, a chunk Vite emits *after* Workbox has built its precache
// manifest — so the chunk is never precached, and its `import()` rejects with
// ERR_INTERNET_DISCONNECTED on every offline start. Nothing is lost by dropping
// it: `registerType: "autoUpdate"` already makes the generated sw.js call
// `skipWaiting()` + `clientsClaim()` (vite.config.ts), and the browser
// revalidates sw.js on each navigation, so a new build takes over on reload.
//
// A failed registration must never break the app (private mode, unsupported
// browser), hence the catch.
if ("serviceWorker" in navigator) {
  // Derived from Vite's base so the path stays correct if the deploy sub-path
  // changes; `sw.js` is emitted at the dist root by vite-plugin-pwa.
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker
    .register(`${base.endsWith("/") ? base : `${base}/`}sw.js`)
    .catch(() => {
      // Offline-first is a progressive enhancement; the app still runs online.
    });
}
