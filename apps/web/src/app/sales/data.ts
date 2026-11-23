export type ExternalItem = { id: number; produtoId: string; varianteId: string; nomeProduto: string; nomeVariante: string; sku: string | null; quantidade: number; precoUnitario: string; desconto: string; total: string; baixaId: number | null; estoque: string };
export type ExternalSale = { id: number; usuarioId: number; requisicaoId: string; origem: "portero"; canal: string; formaPagamento: string; moeda: string; vendidaEm: string;
  situacao: string; situacaoPagamento: string; subtotal: string; descontosItens: string; descontoVenda: string; total: string; valorRecebido: string; valorEstornado: string;
  estoque: string; exigeConferencia: boolean; itens: ExternalItem[]; movimentos: { id: number; tipo: string; valor: string; formaPagamento: string; ocorridoEm: string }[] };
export type OnlineOrder = { id: string; storeId: string; numero: string; origem: "nuvemshop"; canal: "loja_online"; criadoEm: string; status: string; pagamento: string; moeda: string | null; valorProdutos: string | null; totalPedido: string | null };
export type Summary = { periodo: string; fuso: string; inicio: string; fim: string; totais: { moeda: string; canal: string; vendas: number; valorVendido: string; recebimentos: string; estornos: string; recebidoLiquido: string; pagamentosPendentes: number }[]; estoque: { pendentes: number; incertas: number } };
export type OrdersPage = { periodo: string; inicio: string; fim: string; items: OnlineOrder[]; page: number; hasMore: boolean; recebidoNoMes: null; avisoRecebimentos: string };
export type SaleDraft = { canal: string; formaPagamento: string; moeda: string; vendidaEm: string; descontoVenda: string;
  pagamento: { situacao: string; valorRecebido: string; recebidoEm?: string };
  itens: { produtoId: string; varianteId: string; quantidade: number; precoUnitario: string; desconto: string }[] };
export const decimal = (value: unknown): value is string => typeof value === "string" && /^-?\d+\.\d{2}$/.test(value);
export function formatMoney(value: string, currency: string) {
  if (!decimal(value)) return "Valor indisponível";
  const [integer, fraction] = value.split(".");
  return `${currency} ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}
export function monthNow() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", month: "2-digit", year: "numeric" }).formatToParts(new Date());
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}
export async function commercialFetch(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/sales/${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(30_000) });
  const data: unknown = await response.json().catch(() => null);
  return { response, data };
}
export class CommercialError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
function failed(data: unknown, status: number) {
  return new CommercialError(data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "Solicitação não confirmada. Consulte o mesmo registro.", status);
}
export function isSale(value: unknown): value is ExternalSale {
  if (!value || typeof value !== "object") return false;
  const sale = value as ExternalSale;
  return Number.isInteger(sale.id) && sale.id > 0 && sale.origem === "portero" && Number.isInteger(sale.usuarioId) && typeof sale.canal === "string"
    && typeof sale.situacao === "string" && typeof sale.moeda === "string" && decimal(sale.total) && decimal(sale.valorRecebido) && decimal(sale.valorEstornado)
    && Array.isArray(sale.itens) && sale.itens.every(item => Number.isInteger(item.id) && typeof item.varianteId === "string" && typeof item.estoque === "string" && decimal(item.total))
    && Array.isArray(sale.movimentos);
}
export async function fetchSale(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  const { response, data } = await commercialFetch(`external${path}`, init, fetcher);
  if (!response.ok) throw failed(data, response.status);
  if (!isSale(data)) throw new Error("Resposta inválida da venda.");
  return data;
}
export async function listSales(page = 1, signal?: AbortSignal) {
  const { response, data } = await commercialFetch(`external?page=${page}`, { signal });
  if (!response.ok) throw failed(data, response.status);
  const result = data as { items: ExternalSale[]; hasMore: boolean; page: number };
  if (!result || !Array.isArray(result.items) || !result.items.every(isSale) || result.page !== page || typeof result.hasMore !== "boolean") throw new Error("Histórico comercial inválido.");
  return result;
}
export async function fetchSummary(period: string, signal?: AbortSignal) {
  const { response, data } = await commercialFetch(`external/summary?periodo=${period}`, { signal });
  if (!response.ok) throw failed(data, response.status);
  const result = data as Summary;
  if (!result || result.periodo !== period || !Array.isArray(result.totais) || !result.estoque || !result.totais.every(row => decimal(row.valorVendido) && decimal(row.recebidoLiquido))) throw new Error("Resumo comercial inválido.");
  return result;
}
export async function fetchOrders(period: string, page = 1, signal?: AbortSignal) {
  const { response, data } = await commercialFetch(`online-orders?periodo=${period}&page=${page}`, { signal });
  if (!response.ok) throw failed(data, response.status);
  const result = data as OrdersPage;
  if (!result || result.periodo !== period || result.page !== page || typeof result.hasMore !== "boolean" || !Array.isArray(result.items)
    || !result.items.every(item => item.origem === "nuvemshop" && item.canal === "loja_online" && typeof item.id === "string"
      && (item.valorProdutos === null || decimal(item.valorProdutos)))) throw new Error("Resposta inválida dos pedidos.");
  return result;
}
export function onlineTotals(items: OnlineOrder[]) {
  const result = new Map<string, { moeda: string; valor: bigint; pedidos: number; pendentes: number; incompletos: number }>();
  for (const order of new Map(items.map(item => [`${item.storeId}:${item.id}`, item])).values()) {
    if (order.status === "cancelled") continue;
    const key = order.moeda ?? "Não informada";
    const group = result.get(key) ?? { moeda: key, valor: BigInt(0), pedidos: 0, pendentes: 0, incompletos: 0 };
    group.pedidos++;
    if (["pending", "authorized", "partially_paid"].includes(order.pagamento)) group.pendentes++;
    if (order.moeda && order.valorProdutos !== null && ["open", "closed"].includes(order.status)) group.valor += BigInt(order.valorProdutos.replace(".", ""));
    else group.incompletos++;
    result.set(key, group);
  }
  return [...result.values()].map(group => ({ ...group, valor: `${group.valor / BigInt(100)}.${String(group.valor % BigInt(100)).padStart(2, "0")}` }));
}
