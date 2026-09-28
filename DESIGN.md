---
name: Code Scanner
description: On-device QR scanning and encoding, quiet by default
colors:
  sealed-green: "oklch(59.6% 0.145 163.225)"
  sealed-green-deep: "oklch(50.8% 0.118 165.612)"
  sealed-green-bright: "oklch(69.6% 0.17 162.48)"
  sealed-green-glow: "oklch(76.5% 0.177 163.223)"
  sealed-green-soft: "oklch(95% 0.052 163.051)"
  sealed-green-soft-ink: "oklch(43.2% 0.095 166.913)"
  sealed-green-wash: "oklch(97.9% 0.021 166.113)"
  sealed-green-wash-border: "oklch(90.5% 0.093 164.15)"
  sealed-green-wash-ink: "oklch(50.8% 0.118 165.612)"
  paper-slate: "oklch(98.4% 0.003 247.858)"
  paper-slate-sunken: "oklch(96.8% 0.007 247.896)"
  paper-slate-border: "oklch(92.9% 0.013 255.508)"
  paper-slate-border-strong: "oklch(86.9% 0.022 252.894)"
  paper-slate-muted: "oklch(70.4% 0.04 256.788)"
  paper-slate-subtle: "oklch(55.4% 0.046 257.417)"
  paper-slate-body: "oklch(44.6% 0.043 257.281)"
  paper-slate-label: "oklch(37.2% 0.044 257.287)"
  ink: "oklch(27.9% 0.041 260.031)"
  ink-strong: "oklch(20.8% 0.042 265.755)"
  alert-red: "oklch(63.7% 0.237 25.331)"
  alert-red-deep: "oklch(57.7% 0.245 27.325)"
  alert-red-wash: "oklch(97.1% 0.013 17.38)"
  alert-red-wash-border: "oklch(88.5% 0.062 18.334)"
  alert-red-wash-ink: "oklch(50.5% 0.213 27.518)"
  caution-amber: "oklch(66.6% 0.179 58.318)"
  caution-amber-deep: "oklch(55.5% 0.163 48.998)"
  caution-amber-soft: "oklch(96.2% 0.059 95.617)"
  caution-amber-soft-ink: "oklch(47.3% 0.137 46.201)"
  affordance-indigo: "oklch(58.5% 0.233 277.117)"
  affordance-indigo-soft: "oklch(67.3% 0.182 276.935)"
  affordance-blue: "oklch(54.6% 0.245 262.881)"
  surface: "#ffffff"
  viewport-black: "#000000"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  body-medium:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  body-strong:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
  label-medium:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
rounded:
  lg: "0.5rem"
  xl: "0.75rem"
  2xl: "1rem"
  full: "9999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.sealed-green}"
    textColor: "{colors.surface}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.sealed-green-deep}"
  button-primary-disabled:
    backgroundColor: "{colors.paper-slate-border-strong}"
  button-live:
    backgroundColor: "{colors.sealed-green}"
    textColor: "{colors.surface}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-live-hover:
    backgroundColor: "{colors.sealed-green-deep}"
  button-destructive:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.surface}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-destructive-hover:
    backgroundColor: "{colors.alert-red-deep}"
  button-destructive-small:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.surface}"
    typography: "{typography.label-medium}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.625rem"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.paper-slate-label}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-secondary-hover:
    backgroundColor: "{colors.paper-slate}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.2xl}"
    padding: "1rem"
  card-modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.2xl}"
    padding: "1.5rem"
  tab-track:
    backgroundColor: "{colors.paper-slate-sunken}"
    rounded: "{rounded.xl}"
    padding: "0.25rem"
  tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  tab-inactive:
    textColor: "{colors.paper-slate-subtle}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.75rem"
  status-pill-live:
    backgroundColor: "{colors.sealed-green-soft}"
    textColor: "{colors.sealed-green-soft-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.5rem"
  status-pill-paused:
    backgroundColor: "{colors.caution-amber-soft}"
    textColor: "{colors.caution-amber-soft-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.5rem"
  history-row:
    backgroundColor: "{colors.paper-slate}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
  history-row-hover:
    backgroundColor: "{colors.surface}"
  toast-info:
    backgroundColor: "{colors.sealed-green-wash}"
    textColor: "{colors.sealed-green-wash-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  toast-error:
    backgroundColor: "{colors.alert-red-wash}"
    textColor: "{colors.alert-red-wash-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
---

# Design System: Code Scanner

## Overview

**Creative North Star: "The Sealed Envelope"**

The interface behaves like an envelope: content goes in, content comes out, and
nothing about the container draws attention to itself. That metaphor is not
decoration — it is the visual consequence of the product's one hard rule, that
scanned data never leaves the device. A surface that shouted, advertised, or
gamified would contradict the promise. So the system is quiet, cool-toned, and
almost entirely achromatic, with a single green accent reserved for one meaning:
*this worked, and you may proceed*.

Density is deliberately low. There are exactly two screens (Scan, Create),
mounted one at a time rather than hidden, and the page never exceeds a
`max-w-3xl` column. Space does the separating work that borders and shadows would
otherwise do: cards sit on a near-white slate ground with a 1px hairline and a
shadow measured in single pixels. Radii are moderate and consistent — `0.5rem`
for anything interactive, `1rem` for the containers that hold them — so the
system reads as one family rather than a set of unrelated components.

The character is *plain, warm, and restrained at once*. Type is the platform UI
sans at two working sizes; copy is short and literal ("Scan saved to history").
Warmth comes from phrasing and from the soft slate tint rather than from color,
illustration, or motion. The only animation in the entire product is a single
2-second sweep line inside the scanner viewport, and it exists to prove the
camera is live.

**Key Characteristics:**
- One accent (Sealed Green) carrying exactly one meaning: live / success / primary action.
- Achromatic slate foundation; color appears only as state, never as decoration.
- Two working type sizes (0.875rem body, 0.75rem label); 1.125rem reserved for card titles.
- Moderate, consistent radii: 0.5rem interactive, 1rem containers.
- Layered-but-flat elevation: a 1px resting shadow, one lifted exception (the modal).
- System UI font, no web fonts, no icon library — inline 24×24 SVG strokes, 1.5px.
- Single responsive breakpoint (`sm:`, 640px). No dark mode.

## Colors

The palette is a cool slate neutral with a single saturated green; every other
hue is a semantic state with one job. Nothing in the system is chosen for
richness — the greens and reds are Tailwind defaults used at their conventional
steps, and the neutrals carry roughly four times the usage of all accents
combined.

### Primary

- **Sealed Green, fill** (`oklch(50.8% 0.118 165.612)`, `emerald-700`): the fill
  of every green action — the primary button (`QrGenerator.tsx:144`), Copy
  (`ScanResult.tsx:119`), and the live toggle's idle state (`QRScanner.tsx:188`).
  A white label on it measures **5.36:1** — AA for normal text. Also the ink of
  the info toast (`Notification.tsx:9`).
- **Sealed Green, fill hover** (`oklch(43.2% 0.095 166.913)`, `emerald-800`): the
  darkened fill on hover.
- **Sealed Green, mid** (`oklch(59.6% 0.145 163.225)`, `emerald-600`): no longer a
  fill; it survives as the icon hover ink (`ScanHistory.tsx:130`). It is still the
  browser chrome colour (`index.html:16`) — that is untouched by this rule.
- **Sealed Green, live** (`oklch(69.6% 0.17 162.48)`, `emerald-500`): now a
  stroke-only step — the viewfinder brackets and sweep line
  (`QRScanner.tsx:104-108`) and the payload field's focus border
  (`QrGenerator.tsx:75`). It no longer fills a button: the idle Start toggle
  moved onto `sealed-green` for contrast (see Components).
- **Sealed Green, glow** (`oklch(76.5% 0.177 163.223)`, `emerald-400`): the 4px
  drag-over ring on the viewport (`QRScanner.tsx:83`).
- **Sealed Green, wash** (`oklch(97.9% 0.021 166.113)` bg /
  `oklch(90.5% 0.093 164.15)` border / `oklch(50.8% 0.118 165.612)` ink,
  `emerald-50/200/700`): the info toast triple (`Notification.tsx:9`).
- **Sealed Green, tint** (`oklch(95% 0.052 163.051)` bg /
  `oklch(43.2% 0.095 166.913)` ink, `emerald-100/800`): the "Scanning" status
  pill (`QRScanner.tsx:65`).

### Neutral

**Paper Slate** is a cool, low-chroma blue-grey that warms the page just enough
to avoid clinical white. It is the system's structural voice.

- **Paper Slate** (`oklch(98.4% 0.003 247.858)`, `slate-50`): page surface
  (`App.tsx:311`) and the resting fill of history rows (`ScanHistory.tsx:90`).
- **Paper Slate, sunken** (`oklch(96.8% 0.007 247.896)`, `slate-100`): the tab
  track (`ModeTabs.tsx:41`) and modal cancel hover (`ClearConfirmModal.tsx:34`).
- **Paper Slate, border** (`oklch(92.9% 0.013 255.508)`, `slate-200`): the
  default 1px hairline on every card, row, and secondary button — the most-used
  border in the system.
- **Paper Slate, border strong** (`oklch(86.9% 0.022 252.894)`, `slate-300`):
  input borders and the disabled button fill (`QrGenerator.tsx:75,120`).
- **Paper Slate, muted** (`oklch(70.4% 0.04 256.788)`, `slate-400`): idle icon
  color and placeholders (`ScanHistory.tsx:28,230`).
- **Paper Slate, subtle** (`oklch(55.4% 0.046 257.417)`, `slate-500`):
  secondary/meta text and inactive tabs.
- **Paper Slate, body** (`oklch(44.6% 0.043 257.281)`, `slate-600`): dialog body
  and the scanner status line (`ClearConfirmModal.tsx:27`,
  `ImageScanControl.tsx:109`).
- **Paper Slate, label** (`oklch(37.2% 0.044 257.287)`, `slate-700`): form
  labels and secondary-button text.
- **Ink** (`oklch(27.9% 0.041 260.031)`, `slate-800`): card and dialog titles,
  history row text (`ScanHistory.tsx:205,164`).
- **Ink, strong** (`oklch(20.8% 0.042 265.755)`, `slate-900`): page-level text
  and the active tab label (`App.tsx:311`, `ModeTabs.tsx:56`).

### Destructive

- **Alert Red** (`oklch(57.7% 0.245 27.325)`, `red-600`): destructive fills —
  "Stop" while scanning, "Clear history", modal confirm (`QRScanner.tsx:116`,
  `ScanHistory.tsx:216`, `ClearConfirmModal.tsx:40`). Chosen for AA: white on
  `red-600` clears 4.5:1, where `red-500` measured 3.80:1.
- **Alert Red, hover** (`red-700`) and the
  **wash** triple (`red-50/200/700`, `Notification.tsx:10`) for the error toast.

### Warning

- **Caution Amber** (`oklch(66.6% 0.179 58.318)`, `amber-600`): the over-limit
  byte warning (`QrGenerator.tsx:87`).
- **Caution Amber, deep** (`oklch(55.5% 0.163 48.998)`, `amber-700`): the
  generation-failure heading (`QrGenerator.tsx:53`).
- **Caution Amber, tint** (`oklch(96.2% 0.059 95.617)` bg /
  `oklch(47.3% 0.137 46.201)` ink, `amber-100/800`): the "Paused" pill
  (`QRScanner.tsx:66`).

### Affordance

Two non-brand hues appear *only* as per-action hover hints on history rows, to
distinguish otherwise identical icon buttons: **Indigo** (`oklch(58.5% 0.233
277.117)`, `indigo-500` — copy/expand, and the search field's focus ring) and
**Blue** (`oklch(54.6% 0.245 262.881)`, `blue-600` — search the web). They are
never fills, never text at rest, and never a second brand accent.

### Surface

- **Surface** (`#ffffff`): cards, modal panel, tab-active fill, secondary-button
  fill. The most-used single utility in the project.
- **Viewport Black** (`#000000`): the scanner viewport only
  (`QRScanner.tsx:81`), and `#000000` at 50% for the modal scrim
  (`ClearConfirmModal.tsx:18`).

**The One Accent Rule.** Sealed Green is the only brand accent in the system.
Indigo and Blue exist solely as per-action hover affordances on history rows and
must never be promoted to fills, brand marks, or default button colors.

**The Theme-Color Rule.** The browser chrome color is Sealed Green
(`emerald-600`, `oklch(59.6% 0.145 163.225)`). Today `index.html:16` ships
`#3498db`, the only literal color in the project and a hue that appears nowhere
in the palette; this decision supersedes it, and the one-line change is pending.

## Typography

**The system UI stack, at two working sizes.** The single font family is
`ui-sans-serif, system-ui, sans-serif` (plus platform emoji fallbacks), applied
once on `<body>` via `font-sans` (`index.html:26`). No web font is loaded, no
second family is used, and no `font-mono` or `font-serif` appears anywhere —
including for QR payload text in history rows, which stays in the UI sans.

Weights are limited to 400 / 500 / 600. `font-bold` and `tracking-*` are absent
by choice, so hierarchy is carried by size and color rather than by weight
escalation.

### Hierarchy

| Role | Token | Size / weight / line-height | Usage |
|---|---|---|---|
| Card title | `{typography.title}` | 1.125rem / 600 / 1.75rem | Section headings — history title (`ScanHistory.tsx:205`), dialog title (`ClearConfirmModal.tsx:24`) |
| Body strong | `{typography.body-strong}` | 0.875rem / 600 / 1.25rem | Primary buttons, active tab, form labels (`QrGenerator.tsx:65`, `ModeTabs.tsx:54`) |
| Body medium | `{typography.body-medium}` | 0.875rem / 500 / 1.25rem | Secondary buttons and modal actions (`ImageScanControl.tsx:82`, `ClearConfirmModal.tsx:34,40`) |
| Body | `{typography.body}` | 0.875rem / 400 / 1.25rem | Row content, toast text, dialog body — the default reading size |
| Label | `{typography.label}` | 0.75rem / 600 / 1rem | Status pills (`QRScanner.tsx:63`) |
| Label medium | `{typography.label-medium}` | 0.75rem / 500 / 1rem | The small destructive button (`ScanHistory.tsx:216`) |

Supporting detail: the scanner status line is the only place with an explicit
line-height utility — `text-xs leading-5` with `min-h-[1.25rem]`
(`ImageScanControl.tsx:109`) — reserved so the line does not reflow when it
changes from a label to "Decoding…".

**The Two-Size Rule.** Interface text uses only 0.875rem (body) and 0.75rem
(label). 1.125rem is reserved for card-level titles. Do not introduce a fourth
size, and do not use 1.25rem or larger inside this product's panels.

## Layout

A single centred column, `max-w-3xl` (`48rem`), widening to `max-w-5xl`
(`64rem`) at `lg:` (`App.tsx:422`), on a full-height slate ground — `<main>`
carries `min-h-screen bg-slate-50` (`App.tsx:406`) and the `<body>` is
`p-5 bg-white` with no width cap of its own (`index.html:26`). A parent's
max-width cannot be raised by a child, so the body's old `max-w-2xl` used to
clamp the whole app to `42rem`; it was removed rather than kept as a reset.

- Page padding is `1rem`, rising to `1.5rem` at `sm:` — `p-4 sm:p-6`.
- Vertical rhythm between top-level blocks is `1.5rem` (`space-y-6`); `1rem`
  between form groups (`space-y-4`); `0.5rem` between history rows
  (`space-y-2`).
- Cards are single-column with `1rem` internal padding; the scanner card is
  `overflow-hidden` so its header bar and viewport meet the rounded edge cleanly.
- Two fixed max-widths exist inside cards: the viewport caps at `400px`
  (`QRScanner.tsx:81`) and the QR preview image at `320px`
  (`QrGenerator.tsx:99`). Both are centred.
- Two breakpoints are in use: `sm:` (640px) for page padding, and `lg:`
  (1024px), where the content column widens and the scan panel and Scan
  History become a two-column grid (`minmax(0, 1fr) 22rem`, `1.5rem` gap), so
  a desktop leads with the result. There is no `md:` or `xl:`.
- The modal is a fixed, centred overlay with `z-50` and `1rem` of edge padding
  (`ClearConfirmModal.tsx:18`).

## Elevation & Depth

**Layered, with one lifted exception.** Depth is a state signal, not structure:
surfaces are separated by a 1px `Paper Slate border` plus tone, and a shadow
appears only to say a thing is interactive or floating. Nothing casts a resting
shadow larger than 1px of blur radius except the modal.

Two shadow steps exist in the entire product. There is no `shadow-md`, `shadow-lg`,
or custom shadow token.

### Shadow Vocabulary

- **Resting (interactive)** — `--shadow-sm`:
  `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`. Applied to
  cards (`QRScanner.tsx:58`, `QrGenerator.tsx:93`, `ScanHistory.tsx:202`),
  primary and secondary buttons, the active tab, and history rows on hover.
- **Lifted (overlay only)** — `--shadow-xl`:
  `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`.
  Applied to the one confirm dialog (`ClearConfirmModal.tsx:23`). An overlay is
  the only thing permitted to leave the resting plane.

The scanner viewport is a special case handled by ring, not shadow: a 4px
`Sealed Green glow` ring with a `2px` offset appears only during drag-over
(`QRScanner.tsx:82-84`), and the black viewport itself is flat.

**The Quiet Frame Rule.** `shadow-sm` is the resting elevation for anything
interactive; `shadow-xl` is reserved for the modal. Do not add intermediate
shadows, colored shadows, or hover elevation on cards.

## Shapes

Moderate, consistent rounding with a single 1px stroke language:

- `{rounded.lg}` (`0.5rem`) — every interactive control: buttons, inputs, tabs,
  history rows, toasts. This is the most-used radius in the system (~16 sites).
- `{rounded.xl}` (`0.75rem`) — the tab track only, one step larger than the tabs
  it contains so the inner pill reads as nested inside it (`ModeTabs.tsx:41`).
- `{rounded.2xl}` (`1rem`) — card and modal shells (`QRScanner.tsx:58`,
  `QrGenerator.tsx:93`, `ScanHistory.tsx:202`, `ClearConfirmModal.tsx:23`).
- `{rounded.full}` — status pills only (`QRScanner.tsx:63`). The conventional
  `9999px`; Tailwind emits `rounded-full` from a static utility
  (`calc(infinity * 1px)`) rather than a `--radius-*` token, so this entry is a
  deliberate constant rather than a token lookup.
- `rounded`, `rounded-md`, `rounded-3xl`, and `rounded-none` are absent; do not
  introduce them.

Borders are always 1px hairlines. The one legitimate exception to that rule is
the scanner viewport's four corner brackets — `8×8` (`2rem`) squares with a 4px
stroke on two sides each, rounded on the inner corner
(`QRScanner.tsx:104-107`, `border-l-4 border-t-4 border-emerald-500
rounded-tl-lg` and mirrored). They are a viewfinder affordance, drawn as
brackets rather than a full frame, and they are the *only* 4px stroke in the
product.

**The 4px Exception Rule.** A 4px stroke belongs exclusively to the scanner
viewport's corner brackets. Cards, panels, and controls use a 1px hairline
border; a thick single-side accent border on a rounded card is the exact tell
this system avoids.

## Components

### Buttons

- **Primary** — `min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold
  text-white transition hover:bg-emerald-800`
  (`QrGenerator.tsx:144`). No border, no ring. Disabled swaps the fill to
  `Paper Slate border` (`disabled:bg-slate-200`) with a `Paper Slate, subtle`
  label (`disabled:text-slate-500`, 3.86:1) and `cursor-not-allowed`.
- **Live (scanner toggle, idle)** — the same shape and the same fill as the
  primary: `bg-emerald-700 hover:bg-emerald-800` (`QRScanner.tsx:188`), after the
  old `emerald-500` fill measured 2.46:1 against its own white label. Its label
  is the action ("Start"), not a state. White on `emerald-700` measures 5.36:1 —
  AA for normal text; `emerald-600` measured 3.65:1 and is no longer a fill.
- **Destructive** — `bg-red-600 hover:bg-red-700` (`QRScanner.tsx:116`); the
  small variant is `rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium
  text-white hover:bg-red-700` (`ScanHistory.tsx:216`); the modal confirm is
  `flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white
  hover:bg-red-700` (`ClearConfirmModal.tsx:40`).
- **Secondary / ghost** — `rounded-lg border border-slate-200 bg-white px-4 py-2
  text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50`
  (`ImageScanControl.tsx:82,90`). The modal cancel drops the shadow and shadow
  to a slate fill: `border-slate-200 bg-slate-50 hover:bg-slate-100`
  (`ClearConfirmModal.tsx:34`).
- **Focus:** one system rule — `:focus-visible { outline: 2px solid #007a55;
  outline-offset: 2px }` (`public/style.css`), which measures 5.36:1 against the
  page surfaces, plus a white inset variant for a control that carries the
  `emerald-700` fill (white on that fill: 5.36:1). Fields that set
  `focus:outline-none` carry their own ring instead, at the same 3:1 floor.

### Cards / Containers

The repeated shell is `bg-white rounded-2xl border border-slate-200 shadow-sm`
(`QRScanner.tsx:58`, `QrGenerator.tsx:93`, `ScanHistory.tsx:202`). The scanner
card adds `overflow-hidden`; the others add `p-4`. The modal panel is the same
shell at `p-6` with `shadow-xl` instead of `shadow-sm`
(`ClearConfirmModal.tsx:23`).

### Section headers

Inside a card, a header bar separates title from content:
`flex flex-wrap items-center justify-between gap-2 border-b border-slate-100
bg-slate-50 p-4` (`QRScanner.tsx:59`). The history card uses a lighter-weight
variant without the bar: `mb-3 flex flex-wrap items-center justify-between
gap-2` with a `text-lg font-semibold text-slate-800` title and a
`text-sm text-slate-500` count (`ScanHistory.tsx:203-208`).

### Page promise

One persistent line sits directly beneath the mode tabs and outside both panels,
so it renders in either mode: `text-center text-sm text-slate-500` reading
"Runs on your device. Nothing is uploaded." (`App.tsx:343-345`). It is the only
place in the interface where the product's actual mechanism is stated, and it
stays in the secondary text token — no accent, no badge, no icon, no new size.

### Inputs / Fields

- **Textarea (payload)** — `w-full resize-y rounded-lg border border-slate-300
  bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500
  focus:outline-none focus:ring-2 focus:ring-emerald-600`
  (`QrGenerator.tsx:81`). The ring is this field's indicator: `emerald-600` on
  white measures 3.65:1, past the 3:1 non-text minimum; the old `emerald-200`
  measured 1.4:1.
- **Search input** — `w-full rounded-lg border border-slate-200 px-3 py-2
  text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none
  focus:ring-1 focus:ring-indigo-500` (`ScanHistory.tsx:230`). Note the
  inconsistency: the payload field focuses green with a 2px ring, the search
  field focuses indigo with a 1px ring.
- **Label** — `block text-sm font-semibold text-slate-700 mb-1`
  (`QrGenerator.tsx:65`).
- **File input** — unstyled and hidden (`className="hidden"`), driven by a
  secondary button (`ImageScanControl.tsx:94-101`). There is no styled file
  control.
- **Failure card** — when encoding fails while a previous valid code is still on
  screen, one line of `text-xs text-slate-500` reads "Showing your last valid
  code." (`QrGenerator.tsx:57-60`), so a retained preview is never mistaken for
  the code that matches the current input.

### Navigation

The only navigation is a two-item segmented control (Scan / Create):
`role="tablist"` on `inline-flex w-full rounded-xl bg-slate-100 p-1`
(`ModeTabs.tsx:39-41`); each tab is `flex-1 rounded-lg px-4 py-2 text-sm
font-semibold transition`, active `bg-white text-slate-900 shadow-sm`, inactive
`text-slate-500 hover:text-slate-700` (`ModeTabs.tsx:54-58`). The active tab is
a raised white pill inside the sunken track — this is the system's clearest
expression of "layered, one step".

### Status & Feedback

- **Status pill** — `rounded-full px-2 py-1 text-xs font-semibold`, filled
  `bg-emerald-100 text-emerald-800` when scanning and `bg-amber-100
  text-amber-800` when paused (`QRScanner.tsx:63-67`).
- **Toast** — `rounded-lg border px-4 py-2 text-sm` with tone triples
  (`border-emerald-200 bg-emerald-50 text-emerald-700` for info,
  `border-red-200 bg-red-50 text-red-700` for error), and `sr-only` when empty
  so the live region stays mounted (`Notification.tsx:9-10,25-29`). It sits in
  the page flow rather than floating (`App.tsx:342`).
- **Toast action** — an optional inline action (`text-sm font-semibold` with
  `hover:underline`, inheriting the tone's ink) renders only while its own
  message is live (`Notification.tsx:37-46`). Today that is the single-row
  delete's **Undo**: it holds the deleted value for `6000ms` through the
  notification's existing duration option — no separate timer — and re-inserts
  via the same prepending add path. Restore therefore recovers the item's
  content, not its former position. The snapshot is cleared whenever the
  notification is anything other than its own message, so an expired toast can
  never offer an Undo for a different item (`App.tsx:106-114`).
- **Live regions** — `role="status" aria-live="polite"` on the toast and the
  scanner status line (`Notification.tsx:23-24`, `ImageScanControl.tsx:107-108`).

### List Rows

History rows are the densest component: `group w-full rounded-lg border
border-slate-200 bg-slate-50 p-3 hover:border-indigo-400 hover:bg-white
hover:shadow-sm transition-all` (`ScanHistory.tsx:90`). Meta is `text-xs
text-slate-500`; the payload is `mt-1 text-sm text-slate-800 break-words` with
`line-clamp-2` when collapsed (`ScanHistory.tsx:164`). Actions are icon-only
24×24 SVG strokes with a shared base of `p-1 text-slate-400 transition-colors`
(`ScanHistory.tsx:28`) and a per-action hover hue: indigo (copy, expand),
emerald (open URL), blue (search web), red (delete)
(`ScanHistory.tsx:104,117,130,142,153`).

### Signature Component: Scanner Viewport

The one component with no analogue elsewhere:
`relative w-full aspect-square max-w-[400px] mx-auto overflow-hidden rounded-lg
bg-black ring-offset-2 transition`, gaining `ring-4 ring-emerald-400
ring-offset-slate-50` while a drag is active and `ring-0` otherwise
(`QRScanner.tsx:81-85`). Inside it, the library's video fills the frame
(`object-cover`, `finder:false, onOff:true, torch:true, zoom:true`), four
emerald corner brackets frame the target, and a `h-0.5` emerald gradient sweep
line animates top-to-bottom over 2 seconds
(`QRScanner.tsx:104-108`). This viewport is the only black surface, the only
gradient, the only animation, and the only 4px stroke in the product.

## Do's and Don'ts

### Do:

- Do keep Sealed Green (`emerald-600`) for primary actions and success, `emerald-500` for the viewfinder strokes and focus borders, and Alert Red for stopping the camera — never let color carry state on its own.
- Do build new panels from the existing card shell: `rounded-2xl border border-slate-200 bg-white shadow-sm`.
- Do use `0.5rem` radius for controls and `1rem` for containers, and keep borders at 1px hairline.
- Do carry hierarchy with size and slate color; 0.875rem body and 0.75rem label are the working sizes.
- Do keep secondary text at `slate-500` and titles at `slate-800`/`slate-900`.
- Do mount the toast live region unconditionally and toggle `sr-only`, so assistive tech keeps announcing.
- Do keep empty states plain and literal, in the shipped voice ("No scan history yet.").
- Do name the outcome the user actually wanted, not the side effect: a camera scan that copied the value says so ("Scanned — copied to clipboard") and falls back to the plain saved message only when the copy genuinely fails.
- Do state the on-device promise in the interface itself, in the secondary text token, rather than leaving it to documentation.

### Don't:

- Don't add a second brand accent; indigo and blue are per-action hover affordances only.
- Don't put a thick single-side accent border on a rounded card or control; the 4px stroke is reserved for the scanner viewport's corner brackets.
- Don't introduce `shadow-md`/`shadow-lg`, colored shadows, or hover elevation on cards; `shadow-sm` rests, `shadow-xl` floats the modal.
- Don't add a fourth type size, a second font family, a web font, or letter-spacing utilities.
- Don't add more breakpoints; the layout is intentionally single-shape with `sm:` as its only step.
- Don't use color to carry user data, and don't let the palette become decorative — state color only.
- Don't ship a payload color literal outside the palette (the orphan `#3498db` theme-color is being retired, not imitated).
- Don't fill an action with `emerald-600`: a white label on it measures 3.65:1, short of AA 4.5:1. Filled actions use the `emerald-700` fill (5.36:1); `emerald-600` is not a fill.
- Don't let a state-dependent affordance outlive its state: an action snapshot must be cleared when its toast expires or another notification replaces it.
