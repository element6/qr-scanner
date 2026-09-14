/**
 * Pure utility functions for URL validation and data processing.
 * These functions have no side effects and are fully testable.
 */

/**
 * Validates if a given string is a valid HTTP or HTTPS URL.
 *
 * @param value - The string to validate as a URL
 * @returns true if the string is a valid http:// or https:// URL, false otherwise
 *
 * @example
 * ```ts
 * isValidUrl("https://example.com") // true
 * isValidUrl("http://localhost:3000") // true
 * isValidUrl("ftp://example.com") // false
 * isValidUrl("not-a-url") // false
 * isValidUrl("") // false
 * ```
 */
export function isValidUrl(value: string): boolean {
  if (!value || typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Type guard to check if a value is a valid history item.
 */
export interface HistoryItem {
  id: string;
  data: string;
  timestamp: string;
}

/**
 * Persisted (on-disk) history shape. `id` is optional because entries written
 * before ids existed are still in users' localStorage, and
 * `normalizeHistoryItems` backfills one on load. `isValidHistoryItem`
 * validates THIS shape: its predicate previously claimed `HistoryItem`, i.e.
 * a non-empty `id` that it never checked.
 */
export type PersistedHistoryItem = Omit<HistoryItem, "id"> & { id?: unknown };

/**
 * Generates a stable unique id for a history item.
 *
 * Prefers `crypto.randomUUID()` when available (modern browsers, jsdom).
 * Falls back to a composite of the current time and a random value so it
 * works in older environments. Never throws.
 */
export function createHistoryId(): string {
  const cryptoObj: unknown =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (
    cryptoObj &&
    typeof cryptoObj === "object" &&
    typeof (cryptoObj as { randomUUID?: unknown }).randomUUID === "function"
  ) {
    try {
      return (cryptoObj as { randomUUID: () => string }).randomUUID();
    } catch {
      // Fall through to the deterministic fallback.
    }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}



/**
 * Validates if an unknown value matches the persisted HistoryItem shape.
 *
 * Deliberately does NOT require `id`: it must keep accepting legacy entries.
 * Callers that need a guaranteed id go through `normalizeHistoryItems`.
 *
 * @param item - The value to validate
 * @returns true if the item has required data and timestamp properties
 */
export function isValidHistoryItem(
  item: unknown
): item is PersistedHistoryItem {
  if (typeof item !== "object" || item === null) {
    return false;
  }

  const hasData =
    "data" in item &&
    typeof (item as Record<string, unknown>).data === "string";
  const hasTimestamp =
    "timestamp" in item &&
    typeof (item as Record<string, unknown>).timestamp === "string";

  return hasData && hasTimestamp;
}

/**
 * Creates a new history item with the current timestamp.
 *
 * @param data - The scanned data to store
 * @returns A new HistoryItem object
 */
export function createHistoryItem(data: string): HistoryItem {
  return {
    id: createHistoryId(),
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Adds a new item to history and trims to max size.
 *
 * @param history - Current history array
 * @param newItem - New item to add
 * @param maxHistory - Maximum number of items to keep
 * @returns New history array with the new item added and trimmed
 */
export function addToHistory(
  history: HistoryItem[],
  newItem: HistoryItem,
  maxHistory: number
): HistoryItem[] {
  const rest = history.filter((item) => item.data !== newItem.data);
  return [newItem, ...rest].slice(0, maxHistory);
}

/**
 * Normalizes a raw, persisted history array.
 *
 * Keeps only items passing `isValidHistoryItem`, backfills a fresh id onto
 * legacy items that are missing or carry an invalid `id`, collapses value
 * duplicates (newest wins, preserving first-seen order otherwise), and caps
 * the result to `maxHistory`.
 *
 * @param items - Raw array as parsed from storage
 * @param maxHistory - Maximum number of items to keep
 * @returns A clean, id-bearing `HistoryItem[]`
 */
export function normalizeHistoryItems(
  items: unknown[],
  maxHistory: number
): HistoryItem[] {
  const seen = new Set<string>();
  const result: HistoryItem[] = [];
  for (const item of items) {
    if (!isValidHistoryItem(item)) {
      continue;
    }
    const candidate = item;
    const id =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : createHistoryId();
    if (seen.has(candidate.data)) {
      continue;
    }
    seen.add(candidate.data);
    result.push({ id, data: candidate.data, timestamp: candidate.timestamp });
  }
  return result.slice(0, maxHistory);
}
