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
  data: string;
  timestamp: string;
}

/**
 * Validates if an unknown value matches the HistoryItem type.
 *
 * @param item - The value to validate
 * @returns true if the item has required data and timestamp properties
 */
export function isValidHistoryItem(item: unknown): item is HistoryItem {
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
  return [newItem, ...history].slice(0, maxHistory);
}
