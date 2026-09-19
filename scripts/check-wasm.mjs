/**
 * Fails the build if the vendored zxing decoder no longer matches the version of
 * `zxing-wasm` that the app's JS actually loads.
 *
 * Why this exists: `public/zxing/zxing_reader.wasm` is copied out of
 * `node_modules` by hand (see README) so the app can run offline — by default
 * `zxing-wasm` downloads that binary from jsDelivr at runtime. Nothing else
 * connects the committed binary to the installed package, so a dependency bump
 * that updates `node_modules` without re-running the copy would leave a stale
 * binary behind a matching-looking import. The failure mode is silent and
 * offline-only: image scanning breaks with no build error.
 *
 * `ZXING_WASM_SHA256` is the hash the library itself expects, so this pins the
 * binary to the library's own assertion rather than to whatever happens to be on
 * disk. Run via `bun run check:wasm`; CI runs it before the build.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from "zxing-wasm/reader";

const VENDORED = new URL("../public/zxing/zxing_reader.wasm", import.meta.url);

const actual = createHash("sha256")
  .update(readFileSync(fileURLToPath(VENDORED)))
  .digest("hex");

if (actual === ZXING_WASM_SHA256) {
  console.log(
    `vendored zxing wasm matches zxing-wasm@${ZXING_WASM_VERSION} (sha256 ${actual})`
  );
  process.exit(0);
}

console.error(
  [
    "The vendored zxing wasm does not match the installed zxing-wasm.",
    `  file:     ${fileURLToPath(VENDORED)}`,
    `  expected: ${ZXING_WASM_SHA256}  (zxing-wasm@${ZXING_WASM_VERSION})`,
    `  actual:   ${actual}`,
    "",
    "A dependency bump updated node_modules without refreshing the committed",
    "copy, which breaks image scanning offline. Fix with:",
    "",
    "  cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm public/zxing/",
  ].join("\n")
);
process.exit(1);
