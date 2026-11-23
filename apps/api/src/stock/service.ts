import type { AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { StoreCredentials } from "../nuvemshop/products.js";
import type { createStockClient } from "../nuvemshop/stock.js";

export type StockCommand = { produtoId: string; varianteId: string; quantidade: number };
export type StockRecord = {
  id: number; usuarioId: number; produtoId: string; variantId: string;
  quantidadeBaixada: number; statusSincronizacao: string;
};
export interface StockContext {
  store: StoreCredentials;
  operation?: StockRecord;
  hasUnresolved(exceptId?: number): Promise<boolean>;
  create(command: StockCommand): Promise<StockRecord>;
  prepare(id: number, sku: string | null): Promise<void>;
  status(id: number, status: "sincronizada" | "rejeitada" | "incerta"): Promise<void>;
}
export interface StockRepository {
  withLock<T>(auth: AuthContext, target: StockCommand | number, work: (context: StockContext) => Promise<T>): Promise<T>;
}
function result(record: StockRecord, httpStatus: number, message: string, repetida = false) {
  return { httpStatus, body: { baixaId: record.id, produtoId: record.produtoId, varianteId: record.variantId,
    quantidade: record.quantidadeBaixada, statusSincronizacao: record.statusSincronizacao, message, repetida } };
}
function checkStore(context: StockContext, storeId: string) {
  if (context.store.nuvemshopStoreId !== storeId) throw new NuvemshopError(403, "A baixa está limitada à loja configurada nesta instalação.");
}
function getOperation(context: StockContext, auth: AuthContext, id: number) {
  const record = context.operation;
  if (!record || record.id !== id || record.usuarioId !== auth.usuarioId
    || !/^[1-9]\d{0,19}$/.test(record.produtoId) || !/^[1-9]\d{0,19}$/.test(record.variantId)
    || !Number.isSafeInteger(Number(record.variantId)) || !Number.isInteger(record.quantidadeBaixada)
    || record.quantidadeBaixada <= 0 || record.quantidadeBaixada > 2_147_483_647) {
    throw new NuvemshopError(409, "Registro inconsistente. Solicite conferência antes de continuar.");
  }
  return record;
}
export async function registerStockDecrease(repository: StockRepository, storeId: string, auth: AuthContext, command: StockCommand) {
  return repository.withLock(auth, command, async (context) => {
    checkStore(context, storeId);
    if (await context.hasUnresolved()) throw new NuvemshopError(409,
      "A variante possui uma operação pendente ou sem confirmação. Recupere o registro pelo histórico.");
    return result(await context.create(command), 201, "Operação local registrada. O estoque ainda não foi alterado.");
  });
}
export async function inspectStockDecrease(repository: StockRepository, storeId: string, auth: AuthContext, id: number) {
  return repository.withLock(auth, id, async (context) => {
    checkStore(context, storeId);
    return result(getOperation(context, auth, id), 200, "Operação consultada.");
  });
}
export async function cancelStockDecrease(repository: StockRepository, storeId: string, auth: AuthContext, id: number) {
  return repository.withLock(auth, id, async (context) => {
    checkStore(context, storeId);
    const record = getOperation(context, auth, id);
    if (record.statusSincronizacao !== "registrada") throw new NuvemshopError(409, "Somente uma operação ainda não enviada pode ser cancelada.");
    await context.status(id, "rejeitada");
    return result({ ...record, statusSincronizacao: "rejeitada" }, 200, "Registro cancelado. Nenhuma atualização foi enviada.");
  });
}
export async function decreaseStock(repository: StockRepository, client: ReturnType<typeof createStockClient>,
  storeId: string, auth: AuthContext, id: number) {
  return repository.withLock(auth, id, async (context) => {
    checkStore(context, storeId);
    let record = getOperation(context, auth, id);
    if (record.statusSincronizacao === "sincronizada") return result(record, 200, "Baixa já confirmada.", true);
    if (record.statusSincronizacao !== "registrada") return result(record, 409,
      "Esta operação não será reenviada. Confira o histórico antes de continuar.", true);
    if (await context.hasUnresolved(id)) throw new NuvemshopError(409, "A variante possui outra operação sem conclusão. Solicite conferência.");
    let current;
    try {
      current = await client.read(context.store, record.produtoId, record.variantId);
      if (record.quantidadeBaixada > current.quantidade) throw new NuvemshopError(409, "Quantidade maior que o estoque disponível.");
    } catch (error) {
      await context.status(id, "rejeitada");
      return result({ ...record, statusSincronizacao: "rejeitada" }, error instanceof NuvemshopError ? error.status : 502,
        error instanceof NuvemshopError ? error.message : "Consulta de estoque indisponível. Nenhuma atualização foi enviada.");
    }
    const next = current.quantidade - record.quantidadeBaixada;
    // O estado deve estar confirmado no PostgreSQL antes de qualquer envio remoto.
    await context.prepare(id, current.sku);
    record = { ...record, statusSincronizacao: "em_processamento" };
    try { await client.update(context.store, current, next); }
    catch {
      try { await context.status(id, "incerta"); record = { ...record, statusSincronizacao: "incerta" }; } catch {}
      return result(record, 502, "Não foi possível confirmar a baixa. Não registre esta venda novamente; solicite conferência.");
    }
    if (next === 0) {
      // Zero também pode resultar de redução limitada pelo saldo em uma venda concorrente.
      try { await context.status(id, "incerta"); record = { ...record, statusSincronizacao: "incerta" }; } catch {}
      return result(record, 409, "O saldo chegou a zero. A venda está pendente de conferência e não será reenviada.");
    }
    try { await context.status(id, "sincronizada"); }
    catch { return result(record, 503, "A atualização remota foi confirmada, mas o registro local não foi finalizado. Solicite conferência."); }
    return result({ ...record, statusSincronizacao: "sincronizada" }, 200, "Baixa confirmada.");
  });
}
