import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { HistoryItem } from "../utils/validators";
import { otpauthIdentity, scanKind } from "../utils/otpauth";

type ScanHistoryProps = {
  history: HistoryItem[];
  expandedItems: Set<string>;
  onCopyHistoryItem: (data: string) => void;
  onToggleExpand: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onOpenUrl: (data: string) => void;
  onSearchWeb: (data: string) => void;
  onClearHistory: () => void;
  isValidUrl: (value: string) => boolean;
  /** Default true: the App flips it off once `qr2fa.historyMigrated` is set or
   *  the App knows the count is zero. The component never reads that flag. */
  showMigrationBanner?: boolean;
  onMoveOtpauth?: () => void;
  onRemoveOtpauth?: () => void;
};

type HistoryRowProps = {
  item: HistoryItem;
  expanded: boolean;
  isUrl: boolean;
  layoutEpoch: number;
  /** 1-based position in the visible list; part of every action's name. */
  ordinal: number;
  onCopyHistoryItem: (data: string) => void;
  onToggleExpand: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onOpenUrl: (data: string) => void;
  onSearchWeb: (data: string) => void;
};

/** Icon-only row actions: `p-3.5` gives the 16px icon a 44×44 hit box, and
 *  `-m-2.5` pulls the box back to the 24px it visually occupied, so the icon
 *  size and the row's rhythm are unchanged. */
const ICON_BUTTON = "-m-2.5 p-3.5 text-slate-400 transition-colors";

/** Row actions repeat once per row, so a bare "Copy" would be five identical
 *  names in a screen reader's rotor. Two things together tell them apart:
 *
 *  1. the row's ordinal, which is unique by construction — two payloads that
 *     share their opening characters ("https://example.com/shar…") still get
 *     distinct names; and
 *  2. the value itself, which keeps the name content-bearing rather than a bare
 *     "row 3" — a *400-character* payload is still clipped so it cannot become
 *     the whole label, but the bound is wide enough that a real payload is
 *     announced whole. The ordinal is suffixed, not prefixed, so the verb
 *     stays the first word a screen-reader user hears.
 *
 *  A value with no content at all falls back to the ordinal alone.
 */
const ACTION_NAME_VALUE_MAX = 60;

/** otpauth rows are secrets: the seed *is* the payload, so the visible text and
 *  every accessible name collapse to this fixed string and the copy action is
 *  removed outright rather than disabled — a disabled button still advertises
 *  the secret in its label. */
const OTPAUTH_HIDDEN_TEXT = "Authenticator code — hidden";

function isOtpauth(data: string): boolean {
  const kind = scanKind(data);
  return (
    kind === "otpauth-totp" ||
    kind === "otpauth-hotp" ||
    kind === "otpauth-other"
  );
}

/** Display identity for an otpauth row, or null when there is nothing safe to
 *  show. `otpauthIdentity` is the only source: it drops the secret by
 *  construction, so no seed can reach this return value.
 *
 *  A row with an issuer gets the two-line issuer/account shape. A row whose
 *  issuer is empty collapses to the account alone. A row with neither is
 *  treated as unshowable and keeps the redacted text. */
function otpauthRowIdentity(
  data: string
): { issuer: string; account: string } | null {
  const parsed = otpauthIdentity(data);
  if (parsed === null) return null;
  const issuer = parsed.issuer.trim();
  const account = parsed.account.trim();
  if (issuer === "" && account === "") return null;
  return { issuer: issuer === "" ? account : issuer, account };
}

function actionName(verb: string, data: string, ordinal: number): string {
  const value = data.replace(/\s+/g, " ").trim();
  const row = `row ${ordinal}`;
  return value
    ? `${verb} ${value.slice(0, ACTION_NAME_VALUE_MAX)} (${row})`
    : `${verb} (${row})`;
}

/**
 * A single history row.
 *
 * Owns its own overflow measurement so the expand control is only offered when
 * the value is genuinely clipped: an item that renders in two lines or fewer
 * has nothing to reveal, and a toggle there is a dead control.
 */
function HistoryRow({
  item,
  expanded,
  isUrl,
  layoutEpoch,
  ordinal,
  onCopyHistoryItem,
  onToggleExpand,
  onDeleteItem,
  onOpenUrl,
  onSearchWeb,
}: HistoryRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isClipped, setIsClipped] = useState(false);
  const contentId = `${item.id}-content`;
  const otpauth = isOtpauth(item.data);
  // Only otpauth rows get a name; a text or url row keeps rendering its value.
  const identity = otpauth ? otpauthRowIdentity(item.data) : null;
  // Redacted rows never put the raw value in an accessible name.
  const labelFor = (verb: string) =>
    otpauth ? OTPAUTH_HIDDEN_TEXT : actionName(verb, item.data, ordinal);

  // Non-URL values are searchable only if they carry non-whitespace content:
  // `applyDetectedValue` rejects "" but not "   ", so a blank item is reachable
  // and would otherwise render a dead button. otpauth rows are secrets, so they
  // get no search action — the payload would otherwise leave the device in the
  // query string.
  const canSearchWeb = !otpauth && !isUrl && item.data.trim().length > 0;

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;

    // Read a clamped box's *clientHeight* against an unclamped box's
    // *scrollHeight*, never a clamped box's own scrollHeight.
    //
    // Measured in Blink (headless Chrome at 712px and 288px, values from 1 to
    // 60 lines): `scrollHeight` on the clamped box is reported correctly, so
    // the naive `scrollHeight - clientHeight` happens to agree. This is
    // therefore defensive, not a workaround for a reproduced bug: it drops the
    // dependence on a reading WebKit is not verified to report the same way,
    // and iOS Safari is a primary target for camera scanning. Both readings
    // used here are plain block-layout measurements. The clamp is toggled
    // synchronously inside this callback, so nothing paints in between.
    const hadClamp = el.classList.contains("line-clamp-2");
    if (!hadClamp) el.classList.add("line-clamp-2");
    const clampedHeight = el.clientHeight;
    el.classList.remove("line-clamp-2");
    const fullHeight = el.scrollHeight;
    if (hadClamp) el.classList.add("line-clamp-2");

    // 1px tolerance absorbs sub-pixel line-height rounding.
    setIsClipped(fullHeight - clampedHeight > 1);
  }, []);

  // `layoutEpoch` is bumped by the single shared resize listener in
  // `ScanHistory`, so rows re-measure without each owning a window listener.
  useLayoutEffect(() => {
    measure();
  }, [measure, item.data, layoutEpoch]);

  return (
    <div className="group w-full rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-400 hover:bg-white hover:shadow-sm transition-all">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {new Date(item.timestamp).toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          {(isClipped || expanded) && (
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-label={labelFor(expanded ? "Collapse" : "Expand")}
              title={expanded ? "Collapse" : "Expand"}
              className={`${ICON_BUTTON} hover:text-indigo-500`}
            >
              <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          {isUrl && (
            <button
              type="button"
              onClick={() => onOpenUrl(item.data)}
              aria-label={labelFor("Open")}
              title="Open URL"
              className={`${ICON_BUTTON} hover:text-emerald-600`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}
          {canSearchWeb && (
            <button
              type="button"
              onClick={() => onSearchWeb(item.data)}
              aria-label={labelFor("Search with Google for")}
              title="Search with Google"
              className={`${ICON_BUTTON} hover:text-blue-600`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteItem(item.id)}
            aria-label={labelFor("Delete")}
            title="Delete"
            className={`${ICON_BUTTON} hover:text-red-500`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {!otpauth && (
            <button
              type="button"
              onClick={() => onCopyHistoryItem(item.data)}
              aria-label={labelFor("Copy")}
              title="Copy"
              className={`${ICON_BUTTON} hover:text-indigo-500`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div
        ref={contentRef}
        id={contentId}
        className={`mt-1 text-sm text-slate-800 break-words ${expanded ? "" : "line-clamp-2"}`}
      >
        {identity ? (
          <>
            <p className="font-medium text-slate-900">{identity.issuer}</p>
            {identity.account !== identity.issuer && (
              <p className="text-xs text-slate-500">{identity.account}</p>
            )}
          </>
        ) : (
          otpauth ? OTPAUTH_HIDDEN_TEXT : item.data
        )}
      </div>
    </div>
  );
}

export function ScanHistory({
  history,
  expandedItems,
  onCopyHistoryItem,
  onToggleExpand,
  onDeleteItem,
  onOpenUrl,
  onSearchWeb,
  onClearHistory,
  isValidUrl,
  showMigrationBanner = true,
  onMoveOtpauth,
  onRemoveOtpauth,
}: ScanHistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // One resize listener for the whole list: every row shares the same width, so
  // a single signal re-measures them all. Bumping a counter keeps the listener
  // count independent of history length.
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  useLayoutEffect(() => {
    const onResize = () => setLayoutEpoch((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const filteredHistory = searchQuery
    ? history.filter((item) =>
        item.data.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : history;

  // Rows are already classified for redaction, so the banner count is free.
  const otpauthCount = history.filter((item) => isOtpauth(item.data)).length;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-slate-800">
            Scan History
          </h2>
          <span className="text-sm text-slate-500">
            {history.length} saved
          </span>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="min-h-11 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Clear history
          </button>
        )}
      </div>

      {showMigrationBanner && otpauthCount > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            {otpauthCount} authenticator {otpauthCount === 1 ? "code" : "codes"} found in scan history — move to 2FA vault or remove
          </p>
          <p className="text-xs text-amber-800">
            The full otpauth:// link — including the secret — stays in plain text in scan history
            until you act. Moving copies it into the 2FA vault and then removes the history row;
            removing discards it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {onMoveOtpauth && (
              <button
                type="button"
                onClick={onMoveOtpauth}
                aria-label="Move authenticator codes to the 2FA vault"
                className="min-h-11 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Move to 2FA vault
              </button>
            )}
            {onRemoveOtpauth && (
              <button
                type="button"
                onClick={onRemoveOtpauth}
                aria-label="Remove authenticator codes from scan history"
                className="min-h-11 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Remove from history
              </button>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      {filteredHistory.length === 0 ? (
        <p className="text-sm text-slate-500">
          {searchQuery ? "No matching results found." : "No scan history yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredHistory.map((item, index) => (
            <HistoryRow
              key={item.id}
              item={item}
              expanded={expandedItems.has(item.id)}
              isUrl={isValidUrl(item.data)}
              layoutEpoch={layoutEpoch}
              ordinal={index + 1}
              onCopyHistoryItem={onCopyHistoryItem}
              onToggleExpand={onToggleExpand}
              onDeleteItem={onDeleteItem}
              onOpenUrl={onOpenUrl}
              onSearchWeb={onSearchWeb}
            />
          ))}
        </div>
      )}
    </section>
  );
}
