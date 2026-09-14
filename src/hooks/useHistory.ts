/**
 * Custom hook for managing scan history with localStorage persistence.
 * Separates IO operations from UI components.
 */

import { useEffect, useState, useCallback } from "react";
import {
  HistoryItem,
  createHistoryItem,
  addToHistory,
  normalizeHistoryItems,
} from "../utils/validators";

const STORAGE_KEY = "qrScanHistory";
const MAX_HISTORY = 50;

/**
 * Returns the history state and methods for managing scan history.
 * Handles localStorage IO transparently.
 */
export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // `normalizeHistoryItems` rejects malformed entries instead of the
          // whole array; only a structural parse error wipes the key.
          const normalized = normalizeHistoryItems(parsed, MAX_HISTORY);
          setHistory(normalized);
        }
      }
    } catch (err) {
      // Log and leave the key alone: a structural parse error must not wipe the
      // user's whole history (useHistory.ts:38). Malformed entries are rejected
      // individually by `normalizeHistoryItems`; only genuinely unparseable
      // storage lands here, and destroying it would be the worse failure.
      console.warn("Failed to parse scan history", err);
    }
  }, []);

  // Save to localStorage whenever history changes
  const saveToStorage = useCallback((items: HistoryItem[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.error("Failed to save history", err);
    }
  }, []);

  /**
   * Adds a new scan to the history.
   * @param data - The scanned data string
   */
  const addScan = useCallback(
    (data: string) => {
      // Compute the next state first, then commit state and persist — never
      // write localStorage inside a React state updater (useHistory.ts:60-64):
      // updaters may run twice in StrictMode and would double-persist stale
      // `prev`.
      const newItem = createHistoryItem(data);
      const updated = addToHistory(history, newItem, MAX_HISTORY);
      setHistory(updated);
      saveToStorage(updated);
    },
    [history, saveToStorage]
  );

  /**
   * Removes an item from history by id.
   * @param id - The id of the item to remove
   */
  const removeItem = useCallback(
    (id: string) => {
      const updated = history.filter((item) => item.id !== id);
      setHistory(updated);
      saveToStorage(updated);
    },
    [history, saveToStorage]
  );

  /**
   * Clears all history.
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    history,
    addScan,
    removeItem,
    clearHistory,
  };
}

/**
 * Hook for managing the expanded state of history items.
 */
export function useHistoryExpanded() {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return {
    expandedItems,
    toggleExpand,
  };
}
