export type Item = {
  id: string;
  produtoId: string;
  varianteId: string;
  nome: string;
  variante: string;
  sku: string | null;
  preco: number | null;
  quantidade: number | null;
  ruptura: boolean;
  imagemUrl?: string;
};

export type Filtro = "todos" | "ruptura" | "estoque";
export type InventoryPage = { items: Item[]; page: number; nextPage: number | null };

export function isItem(value: unknown): value is Item {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return [item.id, item.produtoId, item.varianteId, item.nome, item.variante].every((field) => typeof field === "string")
    && (item.sku === null || typeof item.sku === "string")
    && (item.preco === null || (typeof item.preco === "number" && Number.isFinite(item.preco)))
    && (item.quantidade === null || (typeof item.quantidade === "number" && Number.isSafeInteger(item.quantidade)))
    && typeof item.ruptura === "boolean"
    && (item.imagemUrl === undefined || typeof item.imagemUrl === "string");
}

export async function carregarInventario(page: number, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<InventoryPage> {
  const response = await fetcher(`/api/inventory?page=${page}`, { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sessão expirada. Entre novamente no PORTERO.");
    if (response.status === 403) throw new Error("Sua conta não possui acesso à loja conectada.");
    throw new Error("Não foi possível carregar o inventário. Tente novamente.");
  }
  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null) throw new Error("Resposta inválida do inventário.");
  const result = data as Record<string, unknown>;
  if (!Array.isArray(result.items) || !result.items.every(isItem) || result.page !== page
    || (result.nextPage !== null && result.nextPage !== page + 1)) throw new Error("Resposta inválida do inventário.");
  return result as InventoryPage;
}

export async function carregarCatalogo(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Item[]> {
  const items = new Map<string, Item>();
  let page: number | null = 1;
  while (page !== null) {
    signal?.throwIfAborted();
    const result = await carregarInventario(page, signal, fetcher);
    for (const item of result.items) items.set(item.id, item);
    page = result.nextPage;
  }
  return [...items.values()];
}

export function filtrarItens(items: Item[], busca: string, filtro: Filtro): Item[] {
  const text = busca.trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) => {
    const matches = [item.nome, item.variante, item.sku ?? ""].some((value) => value.toLocaleLowerCase("pt-BR").includes(text));
    return matches && (filtro === "todos" || (filtro === "ruptura" ? item.ruptura : item.quantidade === null || item.quantidade > 0));
  });
}

export function quantidadeLabel(item: Item): string {
  return item.quantidade === null ? "Sem controle" : `${item.quantidade} UN`;
}

export function precoLabel(item: Item): string {
  return item.preco === null ? "Sob consulta" : item.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
