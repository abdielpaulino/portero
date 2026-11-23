export type Preferences = { limiteRuptura: number; notificacoesAtivas: boolean; emailNotificacoes: string | null; atualizacaoAutomatica: boolean; intervaloSegundos: number; versao: number;
  envioConfigurado: boolean; monitorEm?: string | null; monitorResultado?: string | null; monitorProximaPagina?: number;
  alertas?: { eventoId: string; varianteId: string; nome: string; estado: string }[] };
export async function settingsRequest(path = "", init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/settings${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(45000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Não foi possível confirmar as preferências.");
  return data;
}
export async function loadPreferences(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Preferences> {
  const data = await settingsRequest("", { signal }, fetcher);
  if (!Number.isInteger(data.limiteRuptura) || data.limiteRuptura < 0 || !Number.isInteger(data.intervaloSegundos) || data.intervaloSegundos < 60 || data.intervaloSegundos > 3600
    || !Number.isInteger(data.versao) || typeof data.atualizacaoAutomatica !== "boolean" || typeof data.notificacoesAtivas !== "boolean" || typeof data.envioConfigurado !== "boolean") throw new Error("Preferências inválidas no servidor.");
  return data;
}
