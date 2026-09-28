import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type ScanResultProps = {
  /** The decoded value, shown as plain local text — selectable, never a link. */
  value: string;
  /** Whether the value passed the http(s) gate in `validators.ts`. */
  canOpen: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onScanAnother: () => void;
};

/** Matches the secondary buttons in ImageScanControl / ScanHistory. */
const SECONDARY_BUTTON =
  "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";
/** Neutral ghost: no accent, so the primary Copy keeps the only loud fill. */
const GHOST_BUTTON =
  "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";
/** Voice of the payload itself: large enough to be the focal moment, dark
 *  enough to read as content rather than chrome. */
const PAYLOAD_TEXT = "whitespace-pre-wrap break-words text-base text-slate-900 sm:text-lg";

/** How long the expand/collapse announcement occupies the live region. Long
 *  enough for a polite announcement to fire, short enough that a second toggle
 *  is still a fresh change. */
const ANNOUNCE_RESET_MS = 1000;

/**
 * The result surface: what the Scan panel becomes after a decode.
 *
 * The decoded value is the payoff, so it is the first thing the eye lands on —
 * plain, selectable text on an inset surface, with Copy/Open inline beside it
 * rather than pushed below a tall payload. A long value clamps to three lines
 * and offers an Expand toggle that appears only when the text genuinely
 * overflows, measured rather than guessed.
 */
export function ScanResult({
  value,
  canOpen,
  onCopy,
  onOpen,
  onScanAnother,
}: ScanResultProps) {
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isClipped, setIsClipped] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const contentId = "scan-result-payload";

  /**
   * Measure the clamped box against the unclamped one, the same way
   * `HistoryRow` does: toggle the clamp class synchronously inside the callback
   * so nothing paints between the two reads, and compare plain block-layout
   * values (`clientHeight` clamped vs `scrollHeight` unclamped). A 1px
   * tolerance absorbs sub-pixel line-height rounding.
   */
  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const hadClamp = el.classList.contains("line-clamp-3");
    if (!hadClamp) el.classList.add("line-clamp-3");
    const clampedHeight = el.clientHeight;
    el.classList.remove("line-clamp-3");
    const fullHeight = el.scrollHeight;
    if (hadClamp) el.classList.add("line-clamp-3");
    setIsClipped(fullHeight - clampedHeight > 1);
  }, []);

  // Re-check after every value change and on resize: the toggle is offered only
  // while the text actually overflows, so an expanded value that has already
  // been read in full does not keep a dead Collapse button alive.
  useLayoutEffect(() => {
    measure();
  }, [measure, value]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  // The live region stays mounted so the first toggle also announces (the
  // Notification / ImageScanControl pattern); it is cleared shortly after so a
  // second toggle is a fresh change rather than the same text.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), ANNOUNCE_RESET_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  /** Explicit: "Copy" is terse, so the accessible name says what is copied. */
  function copyLabel(): string {
    return `Copy scan to clipboard: ${value}`;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">Latest scan</span>
        {/* Reserved: the payload-kind label belongs here (clarify step), so the
         *  surface does not invent a name for what it decoded. */}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p
          id={contentId}
          ref={contentRef}
          className={`${PAYLOAD_TEXT} ${expanded ? "" : "line-clamp-3"}`}
        >
          {value}
        </p>
        {/* Actions stay inline with the payload: wrapping to a second line is
         *  natural content height, not a layout shift. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCopy}
            aria-label={copyLabel()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
          >
            Copy
          </button>
          {canOpen && (
            <button type="button" onClick={onOpen} className={SECONDARY_BUTTON}>
              Open URL
            </button>
          )}
          <button type="button" onClick={onScanAnother} className={SECONDARY_BUTTON}>
            Scan another
          </button>
          {isClipped && (
            <button
              type="button"
              onClick={() => {
                setExpanded((n) => !n);
                setAnnouncement(expanded ? "Collapsed" : "Expanded");
              }}
              aria-expanded={expanded}
              aria-controls={contentId}
              className={GHOST_BUTTON}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
