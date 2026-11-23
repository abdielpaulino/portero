import { isItem, type Item } from "../inventory/data";

export type ProductDetail = { produtoId: string; nome: string; items: Item[] };

export async function carregarProduto(produtoId: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProductDetail> {
  if (!/^[1-9]\d{0,19}$/.test(produtoId)) throw new Error("Selecione um produto válido no inventário.");
  const response = await fetcher(`/api/inventory/products/${produtoId}`, { credentials: "same-origin", cache: "no-store", signal });
  if (response.status === 401) throw new Error("Sessão expirada. Entre novamente no PORTERO.");
  if (response.status === 403) throw new Error("Sua conta não possui acesso à loja conectada.");
  if (response.status === 404) throw new Error("Produto não encontrado na loja conectada.");
  if (!response.ok) throw new Error("Não foi possível carregar o produto. Tente novamente.");
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("Resposta inválida do produto.");
  const data = value as Record<string, unknown>;
  if (data.produtoId !== produtoId || typeof data.nome !== "string" || !data.nome.trim() || !Array.isArray(data.items)
    || !data.items.every(item => isItem(item) && item.produtoId === produtoId)) throw new Error("Resposta inválida do produto.");
  return data as ProductDetail;
}
