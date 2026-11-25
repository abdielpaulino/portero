import { commercialFetch, fetchSale, isSale, type ExternalSale } from "./data";
import { clearPending, savePending } from "./pending";

type ItemIdentity = { id: number; produtoId: string; varianteId: string; quantidade: number; baixaId: number | null };
type Progress = { vendaId: number; itens: ItemIdentity[]; emEnvio: number | null };
const ready = (state: string) => ["nao_solicitada", "registrada"].includes(state);
export const stockProgressKey = (storageKey: string, saleId: number) => `${storageKey}:stock:${saleId}`;
export function saleCompleted(sale: ExternalSale) {
  return sale.situacao === "confirmada" && sale.estoque === "sincronizada" && sale.itens.length > 0
    && sale.itens.every(item => item.estoque === "sincronizada" && Number.isInteger(item.baixaId) && item.baixaId! > 0);
}
export function requiresStockReview(sale: ExternalSale) {
  return sale.exigeConferencia || sale.itens.some(item => !ready(item.estoque) && item.estoque !== "sincronizada");
}
export function hasReadyItems(sale: ExternalSale) { return sale.itens.some(item => ready(item.estoque)); }
function identities(sale: ExternalSale): ItemIdentity[] {
  return sale.itens.map(({ id, produtoId, varianteId, quantidade, baixaId }) => ({ id, produtoId, varianteId, quantidade, baixaId }));
}
function sameItems(previous: ItemIdentity[], next: ItemIdentity[]) {
  return previous.length > 0 && previous.length === next.length && new Set(next.map(item => item.id)).size === next.length && previous.every(item => {
    const row = next.find(row => row.id === item.id);
    return row && row.produtoId === item.produtoId && row.varianteId === item.varianteId && row.quantidade === item.quantidade
      && (item.baixaId === null || row.baixaId === item.baixaId);
  });
}
function readProgress(key: string): Progress | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as Progress;
  if (!Number.isInteger(value.vendaId) || !Array.isArray(value.itens) || !value.itens.length
    || !value.itens.every(item => item && Number.isInteger(item.id) && typeof item.produtoId === "string" && typeof item.varianteId === "string"
      && Number.isInteger(item.quantidade) && item.quantidade > 0 && (item.baixaId === null || Number.isInteger(item.baixaId) && item.baixaId > 0))
    || value.emEnvio !== null && !value.itens.some(item => item.id === value.emEnvio)) throw new Error("Confira a atualização desta venda antes de continuar.");
  return value;
}
export function awaitingStockResponse(raw: string | null) {
  if (!raw) return false;
  try { return JSON.parse(raw).emEnvio !== null; } catch { return true; }
}
function matchSale(previous: ExternalSale, next: ExternalSale) {
  return previous.id === next.id && previous.usuarioId === next.usuarioId && previous.requisicaoId === next.requisicaoId
    && sameItems(identities(previous), identities(next));
}
export async function inspectSaleStock(sale: ExternalSale, key: string) {
  const updated = await fetchSale(`/${sale.id}`);
  if (!matchSale(sale, updated)) throw new Error("Não foi possível conferir esta venda. Consulte o histórico.");
  const progress = readProgress(key);
  if (progress && (progress.vendaId !== updated.id || !sameItems(progress.itens, identities(updated)))) throw new Error("O registro salvo não corresponde a esta venda. Consulte o histórico.");
  // A consulta libera apenas a escolha explícita da próxima ação; nunca executa itens.
  if (saleCompleted(updated)) clearPending(key);
  else savePending(key, JSON.stringify({ vendaId: updated.id, itens: identities(updated), emEnvio: null } satisfies Progress));
  return updated;
}
export async function completeSaleStock(sale: ExternalSale, key: string, onUpdate: (sale: ExternalSale) => void, canContinue = () => true) {
  let current = sale;
  const previous = readProgress(key);
  if (previous && (previous.vendaId !== sale.id || !sameItems(previous.itens, identities(sale)) || previous.emEnvio !== null)) {
    throw new Error("Confira a atualização desta venda antes de continuar.");
  }
  if (sale.situacao !== "confirmada" || requiresStockReview(sale)) return current;
  savePending(key, JSON.stringify({ vendaId: sale.id, itens: identities(sale), emEnvio: null } satisfies Progress));
  for (const item of sale.itens) {
    const target = current.itens.find(row => row.id === item.id);
    if (!canContinue() || !target || !ready(target.estoque)) continue;
    // O marcador evita retomada automática no navegador. A garantia entre instâncias continua no PostgreSQL.
    savePending(key, JSON.stringify({ vendaId: current.id, itens: identities(current), emEnvio: item.id } satisfies Progress));
    const { response, data } = await commercialFetch(`external/${sale.id}/items/${item.id}/execute`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const result = data as { venda?: unknown; itemId?: unknown; baixa?: { baixaId?: number; statusSincronizacao?: string } } | null;
    if (!isSale(result?.venda) || result?.itemId !== item.id || !matchSale(current, result.venda)) {
      throw new Error("A resposta do estoque não foi confirmada. Confira a atualização desta venda.");
    }
    const updatedItem = result.venda.itens.find(row => row.id === item.id)!;
    if (!Number.isInteger(updatedItem.baixaId) || updatedItem.baixaId! <= 0 || result.baixa?.baixaId !== updatedItem.baixaId
      || result.baixa?.statusSincronizacao !== updatedItem.estoque) throw new Error("A resposta do estoque não foi confirmada. Confira a atualização desta venda.");
    current = result.venda;
    savePending(key, JSON.stringify({ vendaId: current.id, itens: identities(current), emEnvio: null } satisfies Progress));
    onUpdate(current);
    // 207 pode confirmar este item e deixar os seguintes por executar.
    if (!response.ok || updatedItem.estoque !== "sincronizada" || requiresStockReview(current) || current.situacao !== "confirmada") break;
  }
  if (saleCompleted(current)) clearPending(key);
  return current;
}
