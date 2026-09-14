/**
 * Debounced text → QR encoder hook.
 *
 * Encodes the current text ~150 ms after the last keystroke so typing a long
 * URL does not trigger an encode per key. Cancels the pending timer on
 * unmount and on superseding input; never writes state after unmount.
 */

import { useEffect, useRef, useState } from "react";
import type { QrEncodeResult } from "../utils/qrcode";
import { encodeQrSvg } from "../utils/qrcode";

export interface UseQrCode {
  text: string;
  setText: (t: string) => void;
  result: QrEncodeResult | null;
}

/**
 * @param delayMs Debounce window in ms. Default 150.
 */
export function useQrCode(delayMs = 150): UseQrCode {
  const [text, setText] = useState("");
  const [result, setResult] = useState<QrEncodeResult | null>(null);

  // Refs so the effect always reads the latest values without re-binding.
  const textRef = useRef(text);
  const delayRef = useRef(delayMs);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  textRef.current = text;
  delayRef.current = delayMs;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const setTextDebounced = (next: string) => {
    setText(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!mountedRef.current) return;
      const current = textRef.current;
      if (current === "") {
        setResult(null);
        return;
      }
      encodeQrSvg(current)
        .then((res) => {
          if (!mountedRef.current) return;
          setResult(res);
        })
        .catch(() => {
          // encodeQrSvg never rejects, but stay defensive.
        });
    }, delayRef.current);
  };

  return { text, setText: setTextDebounced, result };
}