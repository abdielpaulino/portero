export type StockHistoryItem = {
  id: number; produtoId: string; varianteId: string; sku: string | null; quantidade: number;
  status: string; criadoEm: string; usuario: { id: number; nome: string; email: string };
};
export type HistoryPage = { items: StockHistoryItem[]; page: number; hasMore: boolean };
function isItem(value: unknown): value is StockHistoryItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as StockHistoryItem;
  return Number.isInteger(item.id) && item.id > 0 && typeof item.produtoId === "string" && typeof item.varianteId === "string"
    && (item.sku === null || typeof item.sku === "string") && Number.isInteger(item.quantidade) && item.quantidade > 0
    && typeof item.status === "string" && typeof item.criadoEm === "string" && item.usuario !== null && typeof item.usuario === "object"
    && Number.isInteger(item.usuario.id) && typeof item.usuario.nome === "string" && typeof item.usuario.email === "string";
}
export async function carregarHistorico(page: number, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<HistoryPage> {
  const response = await fetcher(`/api/inventory/stock-decreases?page=${page}`, { credentials: "same-origin", cache: "no-store", signal });
  if (response.status === 401) throw new Error("Sessão expirada. Entre novamente no PORTERO.");
  if (response.status === 403) throw new Error("Sua conta não possui acesso à loja conectada.");
  if (!response.ok) throw new Error("Não foi possível carregar o histórico. Tente novamente.");
  const data = await response.json();
  if (!data || !Array.isArray(data.items) || !data.items.every(isItem) || data.page !== page || typeof data.hasMore !== "boolean") throw new Error("Resposta inválida do histórico.");
  return data;
}
export function statusLabel(status: string) {
  return ({ registrada: "Registrada — ainda não enviada", pendente: "Pendente do fluxo anterior — conferir", em_processamento: "Em processamento — conferir", incerta: "Sem confirmação — conferir",
    sincronizada: "Confirmada", rejeitada: "Recusada ou cancelada", conferida_parcial: "Conferida — aplicação parcial" } as Record<string, string>)[status] ?? `${status} — conferir`;
}
