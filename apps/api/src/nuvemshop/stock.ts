import { NuvemshopError } from "./oauth.js";
import type { StoreCredentials } from "./products.js";

export type StockSnapshot = {
  produtoId: string;
  varianteId: string;
  sku: string | null;
  quantidade: number;
  inventoryLevels: boolean;
  locationId?: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshot(value: unknown, produtoId: string, varianteId: string): StockSnapshot {
  if (!record(value) || String(value.id) !== varianteId || String(value.product_id) !== produtoId) {
    throw new NuvemshopError(502, "A Nuvemshop retornou uma variante inválida.");
  }
  if (value.stock_management !== true) throw new NuvemshopError(409, "A variante não possui estoque controlado.");
  let quantity = value.stock;
  let locationId: string | undefined;
  const inventoryLevels = value.inventory_levels !== undefined;
  if (inventoryLevels) {
    if (!Array.isArray(value.inventory_levels) || value.inventory_levels.length !== 1 || !record(value.inventory_levels[0])) {
      throw new NuvemshopError(409, "A baixa exige uma variante com um único local de estoque.");
    }
    const level = value.inventory_levels[0];
    quantity = level.stock;
    if (level.location_id !== undefined) {
      if ((typeof level.location_id !== "string" && typeof level.location_id !== "number")
        || !/^[A-Za-z0-9_-]{1,100}$/.test(String(level.location_id))) {
        throw new NuvemshopError(502, "A Nuvemshop retornou um local de estoque inválido.");
      }
      locationId = String(level.location_id);
    }
  }
  if (quantity === null) throw new NuvemshopError(409, "A variante não possui estoque controlado.");
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647
    || (value.sku !== null && typeof value.sku !== "string")) {
    throw new NuvemshopError(502, "A Nuvemshop retornou dados de estoque inválidos.");
  }
  return { produtoId, varianteId, quantidade: quantity, sku: value.sku as string | null, inventoryLevels, locationId };
}

export function createStockClient(userAgent: string, fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
  async function request(store: StoreCredentials, produtoId: string, varianteId: string, body?: unknown): Promise<unknown> {
    if (!/^[1-9]\d*$/.test(store.nuvemshopStoreId) || !/^[\x21-\x7e]{1,4096}$/.test(store.accessToken)
      || !userAgent.trim() || /[\r\n]/.test(userAgent)) {
      throw new NuvemshopError(503, "Confira a configuração da integração Nuvemshop.");
    }
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const path = body === undefined ? varianteId : "stock";
      const response = await fetcher(`https://api.nuvemshop.com.br/2025-03/${store.nuvemshopStoreId}/products/${produtoId}/variants/${path}`, {
        method: body === undefined ? "GET" : "POST", signal, redirect: "error",
        headers: { Accept: "application/json", Authorization: `Bearer ${store.accessToken}`, "User-Agent": userAgent,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 404) throw new NuvemshopError(404, "A variante não foi encontrada na loja conectada.");
      if (!response.ok) throw new NuvemshopError(502, "A Nuvemshop recusou a operação de estoque.");
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw new NuvemshopError(504, "A operação de estoque excedeu o tempo limite.");
      if (error instanceof NuvemshopError) throw error;
      throw new NuvemshopError(502, "Não foi possível confirmar a resposta da Nuvemshop.");
    }
  }
  async function read(store: StoreCredentials, produtoId: string, varianteId: string) {
    return snapshot(await request(store, produtoId, varianteId), produtoId, varianteId);
  }
  async function update(store: StoreCredentials, previous: StockSnapshot, quantity: number) {
    const variantId = Number(previous.varianteId);
    if (!Number.isSafeInteger(variantId) || variantId <= 0 || !Number.isSafeInteger(quantity)
      || quantity < 0 || quantity >= previous.quantidade) {
      throw new NuvemshopError(400, "Informe uma quantidade válida para a baixa.");
    }
    // A variação é aplicada pela Nuvemshop sem repor um saldo lido antes de outra venda.
    const body = { action: "variation", value: quantity - previous.quantidade, id: variantId,
      ...(previous.locationId ? { location_id: previous.locationId } : {}) };
    const response = await request(store, previous.produtoId, previous.varianteId, body);
    if (!Array.isArray(response) || response.length !== 1) {
      throw new NuvemshopError(502, "A Nuvemshop não confirmou somente a variante selecionada.");
    }
    const result = snapshot(response[0], previous.produtoId, previous.varianteId);
    if (result.quantidade !== quantity || result.inventoryLevels !== previous.inventoryLevels || result.locationId !== previous.locationId) {
      throw new NuvemshopError(502, "A resposta da Nuvemshop não confirmou o saldo esperado.");
    }
  }
  return { read, update };
}
