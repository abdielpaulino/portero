import { NuvemshopError } from "./oauth.js";
import type { StoreCredentials } from "./products.js";
import type { Period } from "../sales/repository.js";
import { cents, money } from "../sales/domain.js";

export type OnlineOrder = { id: string; storeId: string; numero: string; origem: "nuvemshop"; canal: "loja_online";
  criadoEm: string; status: string; pagamento: string; moeda: string | null; valorProdutos: string | null; totalPedido: string | null };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function amount(value: unknown) { try { return money(cents(value)); } catch { return null; } }
export function summarizeOrders(items: OnlineOrder[]) {
  const groups = new Map<string, { moeda: string | null; valorPedidos: string; quantidade: number; pagamentosPendentes: number; incompletos: number }>();
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.storeId}:${item.id}`;
    if (seen.has(key)) continue; seen.add(key);
    if (item.status === "cancelled") continue;
    const group = groups.get(item.moeda ?? "") ?? { moeda: item.moeda, valorPedidos: "0.00", quantidade: 0, pagamentosPendentes: 0, incompletos: 0 };
    group.quantidade++;
    if (["pending", "authorized", "partially_paid"].includes(item.pagamento)) group.pagamentosPendentes++;
    if (item.valorProdutos === null || item.moeda === null || !["open", "closed"].includes(item.status)) group.incompletos++;
    else group.valorPedidos = money(cents(group.valorPedidos) + cents(item.valorProdutos));
    groups.set(item.moeda ?? "", group);
  }
  return [...groups.values()];
}
export function createOrdersClient(userAgent: string, fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
  return { async list(store: StoreCredentials, period: Period, page: number) {
    if (!/^[1-9]\d*$/.test(store.nuvemshopStoreId) || !/^[\x21-\x7e]{1,4096}$/.test(store.accessToken) || !userAgent.trim() || /[\r\n]/.test(userAgent)) throw new NuvemshopError(503, "Credenciais de consulta indisponíveis.");
    const url = new URL(`https://api.nuvemshop.com.br/2025-03/${store.nuvemshopStoreId}/orders`);
    for (const [key, value] of Object.entries({ page: String(page), per_page: "50", channels: "store", status: "any",
      created_at_min: period.inicio, created_at_max: new Date(Date.parse(period.fim) - 1).toISOString(),
      fields: "id,store_id,number,created_at,status,payment_status,currency,subtotal,discount,total" })) url.searchParams.set(key, value);
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetcher(url, { method: "GET", redirect: "error", signal,
        headers: { Accept: "application/json", Authorization: `Bearer ${store.accessToken}`, "User-Agent": userAgent } });
      if (response.status === 401 || response.status === 403) throw new NuvemshopError(503, "Consulta de pedidos exige autorização com read_orders; solicite conferência administrativa.");
      if (response.status === 429) throw new NuvemshopError(503, "Limite de consultas da Nuvemshop atingido.");
      if (!response.ok) throw new NuvemshopError(502, "Não foi possível consultar os pedidos.");
      const value: unknown = await response.json();
      if (!Array.isArray(value) || value.length > 50) throw new Error();
      const items: OnlineOrder[] = value.map<OnlineOrder>(value => {
        if (!record(value) || !/^[1-9]\d*$/.test(String(value.id)) || (typeof value.id === "number" && !Number.isSafeInteger(value.id))
          || String(value.store_id) !== store.nuvemshopStoreId || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))
          || typeof value.status !== "string" || typeof value.payment_status !== "string") throw new Error();
        const subtotal = amount(value.subtotal), discount = amount(value.discount);
        let products: string | null = null;
        if (subtotal !== null && discount !== null) { try { products = money(cents(subtotal) - cents(discount)); } catch {} }
        return { id: String(value.id), storeId: store.nuvemshopStoreId, numero: String(value.number ?? value.id), origem: "nuvemshop", canal: "loja_online",
          criadoEm: new Date(value.created_at).toISOString(), status: value.status, pagamento: value.payment_status,
          moeda: typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency) ? value.currency : null,
          valorProdutos: products, totalPedido: amount(value.total) };
      }).filter(item => item.criadoEm >= period.inicio && item.criadoEm < period.fim);
      const next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/);
      const total = response.headers.get("x-total-count");
      let hasMore = value.length === 50;
      if (next) {
        const nextUrl = new URL(next[1]);
        if (![url.origin, "https://api.tiendanube.com"].includes(nextUrl.origin) || nextUrl.pathname !== url.pathname || nextUrl.searchParams.get("page") !== String(page + 1)) throw new Error();
        hasMore = true;
      } else if (total !== null) {
        if (!/^\d+$/.test(total) || !Number.isSafeInteger(Number(total))) throw new Error();
        hasMore = page * 50 < Number(total);
      } else if (response.headers.has("link")) hasMore = false;
      if (hasMore && !value.length) throw new Error();
      return { ...period, items, page, hasMore, totais: summarizeOrders(items), recebidoNoMes: null,
        avisoRecebimentos: "Recebido no mês indisponível: esta consulta não comprova movimentos financeiros datados e estornos." };
    } catch (error) {
      if (signal.aborted) throw new NuvemshopError(504, "A consulta de pedidos excedeu o tempo limite.");
      if (error instanceof NuvemshopError) throw error;
      throw new NuvemshopError(502, "Resposta inválida dos pedidos; nenhum estoque foi alterado.");
    }
  } };
}
