import type { AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { createProductsClient } from "../nuvemshop/products.js";
import type { StockOptions } from "../stock/routes.js";
import { decreaseStock } from "../stock/service.js";
import { hash, presentSale, type PreparedItem, type SaleInput } from "./domain.js";
import type { SalesRepository } from "./repository.js";

export async function createExternalSale(repository: SalesRepository, products: ReturnType<typeof createProductsClient>, auth: AuthContext, key: string, input: SaleInput) {
  const fingerprint = hash(input);
  const previous = await repository.findRequest(auth, key);
  if (previous) {
    if (previous.conteudoHash !== fingerprint) throw new NuvemshopError(409, "A chave já pertence a uma venda com outros dados.");
    return presentSale(previous);
  }
  const store = await repository.store(auth);
  const prepared: PreparedItem[] = [];
  for (const produtoId of new Set(input.itens.map(item => item.produtoId))) {
    const product = await products.get(store, produtoId);
    for (const item of input.itens.filter(item => item.produtoId === produtoId)) {
      const variant = product.items.find(variant => variant.varianteId === item.varianteId);
      if (!variant) throw new NuvemshopError(409, "Uma variante foi removida. Nenhuma venda foi registrada nesta tentativa.");
      prepared.push({ ...item, nomeProduto: variant.nome, nomeVariante: variant.variante, sku: variant.sku });
    }
  }
  return presentSale(await repository.create(auth, key, fingerprint, input, prepared));
}

export async function executeSaleItem(repository: SalesRepository, stock: StockOptions, auth: AuthContext, id: number, itemId: number) {
  if (!stock.enabled) throw new NuvemshopError(503, "Baixas desabilitadas. A venda e seus dados financeiros permanecem registrados.");
  return repository.withSale(auth, id, async sale => {
    if (sale.situacao !== "confirmada") throw new NuvemshopError(409, "Venda cancelada. Nenhuma nova baixa será enviada.");
    const item = sale.itens.find(item => item.id === itemId);
    if (!item) throw new NuvemshopError(404, "Item não pertence à venda.");
    // Criação da baixa e vínculo são confirmados na mesma transação antes do envio remoto.
    const baixaId = item.baixaId ?? await repository.prepareItem(auth, id, itemId);
    const result = await decreaseStock(stock.repository, stock.client, stock.storeId, auth, baixaId, sale.id);
    const updated = presentSale(await repository.get(auth, id));
    return { httpStatus: result.httpStatus === 200 && updated.estoque !== "sincronizada" ? 207 : result.httpStatus,
      body: { venda: updated, itemId, baixa: result.body, message: updated.estoque === "sincronizada"
        ? "Estoque dos itens confirmado. O pagamento permanece independente."
        : "Venda registrada com estoque pendente ou parcial. Confira o resultado de cada item." } };
  });
}
