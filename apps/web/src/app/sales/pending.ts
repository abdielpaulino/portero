"use client";
import { useCallback, useSyncExternalStore } from "react";

const event = "portero:sales-request";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener(event, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(event, listener); };
}
export function usePending(key: string | null) {
  const read = useCallback(() => { try { return key ? window.localStorage.getItem(key) : null; } catch { return null; } }, [key]);
  return useSyncExternalStore(subscribe, read, () => null);
}
export function savePending(key: string, value: string) {
  window.localStorage.setItem(key, value); window.dispatchEvent(new Event(event));
}
export function clearPending(key: string) {
  window.localStorage.removeItem(key); window.dispatchEvent(new Event(event));
}
