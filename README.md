# qr-scanner

QR code scanner webapp with camera access, scan history, and a QR encoder.

- **Scan** — decode QR/barcodes from the camera or an image file.
- **Create** — encode text to an SVG QR code (EC `M`, up to 2,331 bytes).
- Scan history persists in `localStorage` (`qrScanHistory`, max 50 items).

Built with Vite 8 + React 19 + Tailwind CSS 4. Deployed to GitHub Pages at
base `/qr-scanner/`.

## Scripts

```
npm run dev      # start the Vite dev server
npm run build    # build to docs/
npm run test     # vitest (watch)
npm run test:run # vitest (single run)
```