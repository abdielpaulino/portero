"use client";
import { useEffect, useState } from "react";
import { loadPreferences, type Preferences } from "./data";

export function usePreferences(enabled: boolean) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => { void loadPreferences(controller.signal).then(value => { if (!controller.signal.aborted) { setPreferences(value); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) setError("Preferências não confirmadas. Atualização periódica e limite podem estar desatualizados; confira Configurações."); }); };
    refresh(); window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [enabled]);
  return { preferences: enabled && !error ? preferences : null, error: enabled ? error : "" };
}
