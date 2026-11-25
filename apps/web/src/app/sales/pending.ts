"use client";
import { useCallback, useSyncExternalStore } from "react";

const event = "portero:sales-request";
export type SavedRequest<T> = { key: string; body: T; correcting?: boolean };
export function readSavedRequest<T>(value: string): SavedRequest<T> {
  const request = JSON.parse(value);
  if (!request || typeof request.key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(request.key)
    || !request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("Solicitação salva inválida. Consulte o histórico.");
  return request;
}
export function correctionKey(value: string | null) {
  try { const request = value ? readSavedRequest(value) : null; return request?.correcting === true ? request.key : null; }
  catch { return null; }
}
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
export function clearSavedRequest(key: string, requestKey: string) {
  const value = window.localStorage.getItem(key);
  if (!value) return;
  let current;
  try { current = readSavedRequest(value); } catch { return; }
  if (current.key === requestKey) clearPending(key);
}
