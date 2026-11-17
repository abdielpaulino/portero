export type Session = { usuarioId: number; loja: { id: number; nomeLoja: string } };

export async function carregarSessao(url = "/api/auth/session", init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Session | null> {
  const response = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store" });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Não foi possível verificar sua sessão. Tente novamente.");
  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null) throw new Error("Resposta inválida da sessão.");
  const value = data as Record<string, unknown>;
  const loja = value.loja as Record<string, unknown> | null;
  if (typeof value.usuarioId !== "number" || !Number.isSafeInteger(value.usuarioId) || value.usuarioId <= 0
    || typeof loja !== "object" || loja === null || typeof loja.id !== "number" || !Number.isSafeInteger(loja.id)
    || loja.id <= 0 || typeof loja.nomeLoja !== "string") throw new Error("Resposta inválida da sessão.");
  return data as Session;
}

export async function encerrarSessao(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível sair. Tente novamente.");
}
