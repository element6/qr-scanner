import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseOtpauth, scanKind, type ScanKind } from "../utils/otpauth";

type ScanResultProps = {
  /** The decoded value, shown as plain local text — selectable, never a link. */
  value: string;
  /** Whether the value passed the http(s) gate in `validators.ts`. */
  canOpen: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onScanAnother: () => void;
  /** Payload class. Optional so existing call sites compile unchanged; when
   *  absent it is derived from `value` rather than assumed, because assuming
   *  "text" here would render an OTP seed. */
  kind?: ScanKind;
  /** Non-secret identity to display for `otpauth-totp`. */
  entry?: { issuer: string; account: string } | null;
  /** When omitted, the TOTP branch stays informational and offers no action. */
  onSaveToVault?: () => void;
};

/** Issuer/account only — the parser's secret field is deliberately dropped so
 *  no seed can travel further than this function's return value. */
function parsedIdentity(value: string): { issuer: string; account: string } | null {
  const result = parseOtpauth(value);
  return result.ok ? { issuer: result.entry.issuer, account: result.entry.account } : null;
}

/** Matches the secondary buttons in ImageScanControl / ScanHistory. */
const SECONDARY_BUTTON =
  "min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";
/** Neutral ghost: no accent, so the primary Copy keeps the only loud fill. */
const GHOST_BUTTON =
  "min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";
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
  kind,
  entry = null,
  onSaveToVault,
}: ScanResultProps) {
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isClipped, setIsClipped] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const contentId = "scan-result-payload";

  /**
   * Fail closed: an absent `kind` is classified from `value` by the shared
   * `scanKind`, never assumed to be "text". A call site that forgets the prop
   * must not be able to render an OTP seed. Every non-otpauth value classifies
   * as text/url, so those take the unchanged branch below either way.
   */
  const effectiveKind: ScanKind = kind ?? scanKind(value);
  const isOtp =
    effectiveKind === "otpauth-totp" ||
    effectiveKind === "otpauth-hotp" ||
    effectiveKind === "otpauth-other";

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

  /**
   * SECURITY: an `otpauth://` value is the account's shared secret, not
   * content. It is never rendered, never copied, never used as an aria-label
   * or title, and never placed in an attribute — the whole branch is built
   * from `entry` (issuer/account) and fixed strings only, so there is nothing
   * for a screen reader, a clipboard sync or `textContent` to pick up. A
   * missing `entry` still shows the block, just without the identity lines.
   */
  if (isOtp) {
    const isTotp = effectiveKind === "otpauth-totp";
    const identity = isTotp ? entry ?? parsedIdentity(value) : null;

    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Latest scan</h2>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {isTotp ? (
            <>
              {identity?.issuer ? <p className={PAYLOAD_TEXT}>{identity.issuer}</p> : null}
              {identity?.account ? (
                <p className="mt-1 text-sm text-slate-600">{identity.account}</p>
              ) : null}
            </>
          ) : (
            <p className={PAYLOAD_TEXT}>Unsupported authenticator code</p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isTotp && onSaveToVault && (
            <button
              type="button"
              onClick={onSaveToVault}
              aria-label="Save to 2FA vault"
              className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
            >
              Save to 2FA vault
            </button>
          )}
          <button
            type="button"
            onClick={onScanAnother}
            aria-label="Scan another"
            className={SECONDARY_BUTTON}
          >
            Scan another
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Latest scan</h2>
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
            className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
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
