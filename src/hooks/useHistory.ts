/**
 * Custom hook for managing scan history with localStorage persistence.
 * Separates IO operations from UI components.
 */

import { useEffect, useState, useCallback } from "react";
import {
  HistoryItem,
  createHistoryItem,
  addToHistory,
  isValidHistoryItem,
} from "../utils/validators";

const STORAGE_KEY = "qrScanHistory";
const MAX_HISTORY = 50;

/**
 * Returns the history state and methods for managing scan history.
 * Handles localStorage IO transparently.
 */
export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const validItems = parsed.filter(isValidHistoryItem);
          setHistory(validItems);
        }
      }
    } catch (err) {
      console.warn("Failed to parse scan history", err);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
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
      const newItem = createHistoryItem(data);
      setHistory((prev) => {
        const updated = addToHistory(prev, newItem, MAX_HISTORY);
        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage]
  );

  /**
   * Removes an item from history by index.
   * @param index - The index of the item to remove
   */
  const removeItem = useCallback(
    (index: number) => {
      setHistory((prev) => {
        const updated = prev.filter((_, i) => i !== index);
        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage]
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
    isLoading,
    addScan,
    removeItem,
    clearHistory,
    maxHistory: MAX_HISTORY,
  };
}

/**
 * Hook for managing the expanded state of history items.
 */
export function useHistoryExpanded() {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback(
    (index: number) => expandedItems.has(index),
    [expandedItems]
  );

  return {
    expandedItems,
    toggleExpand,
    isExpanded,
  };
}
