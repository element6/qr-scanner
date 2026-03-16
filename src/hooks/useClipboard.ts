/**
 * Custom hook for clipboard operations.
 * Provides a clean interface for copying text to the clipboard.
 */

import { useCallback, useRef, useState } from "react";

/**
 * Result type for clipboard operations.
 */
export interface ClipboardResult {
  success: boolean;
  error?: string;
}

/**
 * Hook for managing clipboard operations.
 * Provides async copy functionality with error handling.
 */
export function useClipboard() {
  const [lastResult, setLastResult] = useState<ClipboardResult | null>(null);

  /**
   * Copies text to the clipboard.
   * @param text - The text to copy
   * @returns Promise that resolves to the result
   */
  const copy = useCallback(async (text: string): Promise<ClipboardResult> => {
    if (!text) {
      const result = { success: false, error: "No text to copy" };
      setLastResult(result);
      return result;
    }

    try {
      await navigator.clipboard.writeText(text);
      const result = { success: true };
      setLastResult(result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Copy failed";
      const result = { success: false, error: errorMessage };
      setLastResult(result);
      return result;
    }
  }, []);

  /**
   * Clears the last result state.
   */
  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  return {
    copy,
    lastResult,
    clearResult,
  };
}

/**
 * Hook for managing notification state with auto-dismiss.
 */
export function useNotification(initialValue = "") {
  const [message, setMessage] = useState(initialValue);
  const timerRef = useRef<number | undefined>(undefined);

  /**
   * Shows a notification message that auto-dismisses after a delay.
   * @param msg - The message to display
   * @param duration - Time in ms before auto-dismiss (default: 2200)
   */
  const notify = useCallback((msg: string, duration = 2200) => {
    // Clear any existing timer before setting a new one
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }

    setMessage(msg);
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => {
        setMessage("");
        timerRef.current = undefined;
      }, duration);
    }
  }, []);

  /**
   * Clears the current notification.
   */
  const clear = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setMessage("");
  }, []);

  return {
    message,
    notify,
    clear,
    isVisible: message !== "",
  };
}

/**
 * Hook for managing keyboard shortcuts.
 * Handles global keyboard events with proper cleanup.
 */
export interface ShortcutHandler {
  key: string;
  handler: () => void;
  modifier?: "ctrl" | "shift" | "alt" | "meta";
}

export function useKeyboardShortcuts(shortcuts: ShortcutHandler[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const { key, handler, modifier } = shortcut;

        // Check modifier if specified
        if (modifier) {
          const modifierPressed =
            (modifier === "ctrl" && e.ctrlKey) ||
            (modifier === "shift" && e.shiftKey) ||
            (modifier === "alt" && e.altKey) ||
            (modifier === "meta" && e.metaKey);

          if (!modifierPressed) continue;
        }

        if (e.key.toLowerCase() === key.toLowerCase()) {
          e.preventDefault();
          handler();
          return;
        }
      }
    },
    [shortcuts]
  );

  return { handleKeyDown };
}
