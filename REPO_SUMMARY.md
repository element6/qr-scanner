# Repository Summary: qr-scanner

## YAML (Human-Readable)

```yaml
name: qr-scanner
description: QR code scanner webapp with camera access and scan history
type: web-application
language: TypeScript/React
framework: Vite + React 19

tech_stack:
  frontend:
    - React 19.2.4
    - React DOM 19.2.4
    - Tailwind CSS 4.1.11
    - @yudiel/react-qr-scanner 2.5.1
  build:
    - Vite 8.0.0
    - @vitejs/plugin-react 6.0.0
    - @tailwindcss/vite 4.1.11
  dev:
    - TypeScript types
    - Autoprefixer
    - PostCSS

entry_points:
  - src/main.tsx         # React entry point
  - src/App.tsx          # Main app component with scanner UI

config_files:
  - vite.config.ts       # Vite config (base: /qr-scanner/, output: docs/)
  - package.json         # Dependencies and scripts
  - manifest.json        # PWA manifest
  - index.html           # HTML template

modules:
  App:
    file: src/App.tsx
    purpose: Main scanner component with camera, history, and actions
    functions:
      - handleScan: Process detected QR codes
      - handleError: Camera error handling
      - clearHistory: Clear localStorage history
      - copyToClipboard: Copy scanned data
      - openUrl: Open valid URLs
      - toggleScanner: Pause/resume camera

dependencies:
  external:
    - @yudiel/react-qr-scanner (QR scanning)
    - react, react-dom (UI framework)
    - tailwindcss (styling)

side_effects:
  - localStorage: Persists scan history (key: qrScanHistory, max: 50 items)
  - navigator.clipboard: Copy to clipboard
  - window.open: Open URLs in new tab
  - Camera API: Device camera access for scanning

deployment:
  ci: GitHub Actions (.github/workflows/deploy.yml)
  host: GitHub Pages
  output: docs/ folder
  base_path: /qr-scanner/

tests: none
linting: none
```

## JSON (AI-Indexable)

```json
{
  "name": "qr-scanner",
  "type": "web-application",
  "language": "typescript",
  "framework": "react",
  "build": "vite",
  "entry_points": [
    "src/main.tsx",
    "src/App.tsx"
  ],
  "modules": {
    "App": {
      "file": "src/App.tsx",
      "exports": ["default"],
      "functions": [
        {"name": "handleScan", "params": ["detectedCodes"], "sideEffects": ["localStorage"]},
        {"name": "handleError", "params": ["err"]},
        {"name": "clearHistory", "sideEffects": ["localStorage"]},
        {"name": "copyToClipboard", "sideEffects": ["clipboard API"]},
        {"name": "openUrl", "sideEffects": ["window.open"]},
        {"name": "toggleScanner", "params": []}
      ],
      "state": ["scannedData", "error", "paused", "history", "notification"]
    }
  },
  "config": {
    "vite": {"base": "/qr-scanner/", "outDir": "docs"},
    "pwa": {"name": "Code Scanner", "themeColor": "#3498db"}
  },
  "dependencies": {
    "@yudiel/react-qr-scanner": "^2.5.1",
    "react": "^19.2.4",
    "tailwindcss": "^4.1.11"
  },
  "storage": {
    "localStorage": {"key": "qrScanHistory", "maxItems": 50}
  },
  "deployment": {
    "ci": "GitHub Actions",
    "host": "GitHub Pages"
  }
}
```

---

**Summary:** A lightweight React QR scanner PWA that uses the device camera to scan codes, stores history in localStorage, and can open valid URLs. Built with Vite + Tailwind CSS, deploys to GitHub Pages. No tests or linting configured.
