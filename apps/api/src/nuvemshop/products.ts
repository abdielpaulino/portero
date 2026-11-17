import { NuvemshopError } from "./oauth.js";

export type InventoryItem = {
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

export type StoreCredentials = { id: number; nuvemshopStoreId: string; accessToken: string };
const PAGE_SIZE = 100;

function invalidResponse(): never {
  throw new NuvemshopError(502, "A Nuvemshop retornou dados inválidos do inventário.");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(value: unknown): string {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return invalidResponse();
}

function localized(value: unknown, language: string): string {
  if (!record(value)) return invalidResponse();
  const text = [value[language], value.pt, ...Object.values(value)]
    .find((entry) => typeof entry === "string" && entry.trim());
  return typeof text === "string" ? text.trim() : invalidResponse();
}

function normalize(products: unknown[], language: string): InventoryItem[] {
  return products.flatMap((product) => {
    if (!record(product) || !Array.isArray(product.variants) || !Array.isArray(product.images)) return invalidResponse();
    const produtoId = id(product.id);
    const nome = localized(product.name, language);
    const images = product.images;
    return product.variants.map((variant): InventoryItem => {
      if (!record(variant) || !Array.isArray(variant.values) || typeof variant.stock_management !== "boolean"
        || (variant.sku !== null && typeof variant.sku !== "string")) return invalidResponse();
      const varianteId = id(variant.id);
      let quantidade: number | null = null;
      if (variant.stock_management) {
        // inventory_levels prevalece sobre o saldo agregado legado.
        const levels = variant.inventory_levels;
        const stocks = levels === undefined ? [variant.stock]
          : Array.isArray(levels) && levels.length > 0 ? levels.map((level) => record(level) ? level.stock : undefined)
          : invalidResponse();
        if (!stocks.every((stock) => typeof stock === "number" && Number.isSafeInteger(stock))) return invalidResponse();
        quantidade = (stocks as number[]).reduce((total, stock) => total + stock, 0);
        if (!Number.isSafeInteger(quantidade)) return invalidResponse();
      }
      const price = variant.price;
      if (price !== null && (typeof price !== "string" || !/^\d+(?:\.\d+)?$/.test(price))) return invalidResponse();
      const preco = price === null ? null : Number(price);
      if (preco !== null && !Number.isFinite(preco)) return invalidResponse();
      const image = images.find((entry) => record(entry) && entry.id === variant.image_id) ?? images[0];
      let imagemUrl: string | undefined;
      if (record(image) && typeof image.src === "string") {
        try {
          const url = new URL(image.src.startsWith("//") ? `https:${image.src}` : image.src);
          if (url.protocol === "http:" || url.protocol === "https:") imagemUrl = url.toString();
        } catch { imagemUrl = undefined; }
      }
      return { id: `${produtoId}:${varianteId}`, produtoId, varianteId, nome,
        variante: variant.values.length ? variant.values.map((value) => localized(value, language)).join(" / ") : "Única",
        sku: variant.sku as string | null, preco, quantidade, ruptura: quantidade !== null && quantidade <= 0,
        ...(imagemUrl ? { imagemUrl } : {}) };
    });
  });
}

export function createProductsClient(userAgent: string, fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
  async function list(store: StoreCredentials, page: number) {
    if (!userAgent.trim() || /[\r\n]/.test(userAgent)) {
      throw new NuvemshopError(503, "A identificação da integração Nuvemshop não está configurada.");
    }
    if (!/^[1-9]\d*$/.test(store.nuvemshopStoreId) || !/^[\x21-\x7e]{1,4096}$/.test(store.accessToken)) {
      throw new NuvemshopError(409, "A loja não possui credenciais válidas. Refaça a conexão OAuth.");
    }
    const url = new URL(`https://api.nuvemshop.com.br/2025-03/${store.nuvemshopStoreId}/products`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("fields", "id,name,images,variants");
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetcher(url, { method: "GET", redirect: "error", signal,
        headers: { Accept: "application/json", Authorization: `Bearer ${store.accessToken}`, "User-Agent": userAgent } });
      if (response.status === 401 || response.status === 403) {
        throw new NuvemshopError(502, "A Nuvemshop recusou o acesso aos produtos. Confira a conexão e as permissões do app.");
      }
      if (response.status === 429) throw new NuvemshopError(503, "Limite de consultas da Nuvemshop atingido. Tente novamente em instantes.");
      if (!response.ok) throw new NuvemshopError(502, "Não foi possível consultar o inventário na Nuvemshop.");
      const products: unknown = await response.json();
      if (!Array.isArray(products) || products.length > PAGE_SIZE) return invalidResponse();
      const items = normalize(products, response.headers.get("x-main-language") ?? "pt");
      const next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/);
      const total = response.headers.get("x-total-count");
      let hasNext = products.length === PAGE_SIZE;
      if (next) {
        // O link remoto nunca é usado como destino de uma chamada com credenciais.
        const nextUrl = new URL(next[1]);
        if (![url.origin, "https://api.tiendanube.com"].includes(nextUrl.origin) || nextUrl.pathname !== url.pathname
          || nextUrl.searchParams.get("page") !== String(page + 1)) return invalidResponse();
        hasNext = true;
      } else if (total !== null) {
        if (!/^\d+$/.test(total) || !Number.isSafeInteger(Number(total))) return invalidResponse();
        hasNext = page * PAGE_SIZE < Number(total);
      } else if (response.headers.has("link")) {
        hasNext = false;
      }
      if (hasNext && products.length === 0) return invalidResponse();
      return { items, page, nextPage: hasNext ? page + 1 : null };
    } catch (error) {
      if (signal.aborted) throw new NuvemshopError(504, "A Nuvemshop demorou para responder. Tente novamente.");
      if (error instanceof NuvemshopError) throw error;
      throw new NuvemshopError(502, "Não foi possível obter uma resposta válida do inventário.");
    }
  }
  return { list };
}
