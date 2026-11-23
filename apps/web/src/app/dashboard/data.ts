import { carregarCatalogo } from "../inventory/data";
import { carregarHistorico } from "../history/data";

export async function carregarDashboard(signal?: AbortSignal, fetcher: typeof fetch = fetch, limit = 0) {
  const [variants, history] = await Promise.all([carregarCatalogo(signal, fetcher), carregarHistorico(1, signal, fetcher)]);
  return {
    produtos: new Set(variants.map(item => item.produtoId)).size,
    variantes: variants.length,
    semEstoque: variants.filter(item => item.quantidade !== null && item.quantidade <= 0).length,
    emRuptura: variants.filter(item => item.quantidade !== null && item.quantidade <= limit).length,
    semControle: variants.filter(item => item.quantidade === null).length,
    negativas: variants.filter(item => item.quantidade !== null && item.quantidade < 0).length,
    recentes: history.items.slice(0, 5),
  };
}

export type DashboardData = Awaited<ReturnType<typeof carregarDashboard>>;
