import type { Item } from "./data";
type Variant = Pick<Item, "produtoId" | "varianteId">;
type OperationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingDecrease = Variant & { quantidade: number; baixaId: number | null };
export type Operation = Variant & { quantidade: number; baixaId: number; statusSincronizacao: string };
export type DecreaseResult = { kind: "success" | "rejected" | "pending"; message: string; needsLogin?: boolean };
const recoveryMessage = "Criação não confirmada. Recupere a operação pelo histórico; não registre esta venda novamente.";
function storageKey(item: Variant) { return `portero:baixa:${item.produtoId}:${item.varianteId}`; }
export async function comTravaDaBaixa<T>(item: Variant, work: () => Promise<T>,
  locks: Pick<LockManager, "request"> | undefined = typeof navigator === "undefined" ? undefined : navigator.locks): Promise<T> {
  if (!locks?.request) throw new Error("Use um navegador atualizado em localhost ou HTTPS para dar baixa.");
  return locks.request(storageKey(item), { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Esta variante está sendo processada em outra aba. Aguarde e consulte o histórico.");
    return work();
  });
}
function operationStorage(): OperationStorage | undefined {
  if (typeof window === "undefined") return undefined;
  const current = window.localStorage, legacy = window.sessionStorage;
  return {
    getItem(key) {
      const saved = current.getItem(key), previous = legacy.getItem(key);
      if (saved && previous && saved !== previous) throw new Error("Pendências diferentes no navegador.");
      if (!saved && previous) { current.setItem(key, previous); legacy.removeItem(key); }
      return saved ?? previous;
    },
    setItem(key, value) { current.setItem(key, value); legacy.removeItem(key); },
    removeItem(key) { current.removeItem(key); legacy.removeItem(key); },
  };
}
export function quantidadeValida(value: number) { return Number.isInteger(value) && value > 0 && value <= 2_147_483_647; }
export function criarBaixa(item: Variant, quantidade: number): PendingDecrease {
  if (!quantidadeValida(quantidade)) throw new Error("Informe uma quantidade inteira positiva.");
  return { produtoId: item.produtoId, varianteId: item.varianteId, quantidade, baixaId: null };
}
export function lerBaixaPendente(item: Variant, storage = operationStorage()): PendingDecrease | null {
  try {
    const saved = storage?.getItem(storageKey(item));
    if (!saved) return null;
    const data = JSON.parse(saved);
    if (!data || data.produtoId !== item.produtoId || data.varianteId !== item.varianteId || !quantidadeValida(data.quantidade)) throw new Error();
    // UUIDs do fluxo antigo não permitem identificar uma operação no banco original.
    const id = data.key ? null : data.baixaId;
    if (id !== null && (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647)) throw new Error();
    return { produtoId: item.produtoId, varianteId: item.varianteId, quantidade: data.quantidade, baixaId: id };
  } catch { throw new Error("Pendência inválida no navegador. Solicite conferência pelo histórico."); }
}
export function guardarBaixa(operation: PendingDecrease, storage = operationStorage(), recovery = false) {
  if (!storage) throw new Error("Armazenamento indisponível. Nenhuma execução foi solicitada.");
  const saved = lerBaixaPendente(operation, storage);
  if (saved && (saved.baixaId !== null && saved.baixaId !== operation.baixaId
    || (!recovery && saved.quantidade !== operation.quantidade))) throw new Error("Há outra operação pendente. Consulte o histórico.");
  storage.setItem(storageKey(operation), JSON.stringify(operation));
}
export function limparBaixa(operation: PendingDecrease, storage = operationStorage()) {
  if (!storage) throw new Error("Armazenamento indisponível.");
  if (lerBaixaPendente(operation, storage)?.baixaId === operation.baixaId) storage.removeItem(storageKey(operation));
}
function validOperation(data: unknown): data is Operation {
  if (typeof data !== "object" || data === null) return false;
  const value = data as Record<string, unknown>;
  return typeof value.baixaId === "number" && Number.isInteger(value.baixaId) && value.baixaId > 0 && value.baixaId <= 2_147_483_647
    && typeof value.produtoId === "string" && typeof value.varianteId === "string"
    && typeof value.quantidade === "number" && quantidadeValida(value.quantidade) && typeof value.statusSincronizacao === "string";
}
export async function registrarBaixa(operation: PendingDecrease, fetcher: typeof fetch = fetch): Promise<PendingDecrease> {
  if (operation.baixaId !== null) throw new Error("Esta operação já possui ID.");
  try {
    const response = await fetcher("/api/inventory/stock-decreases", { method: "POST", credentials: "same-origin", cache: "no-store",
      signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ produtoId: operation.produtoId, varianteId: operation.varianteId, quantidade: operation.quantidade }) });
    const data: unknown = await response.json();
    if (response.status !== 201 || !validOperation(data) || data.statusSincronizacao !== "registrada"
      || data.produtoId !== operation.produtoId || data.varianteId !== operation.varianteId || data.quantidade !== operation.quantidade) throw new Error();
    return { ...operation, baixaId: data.baixaId };
  } catch { throw new Error(recoveryMessage); }
}
export async function consultarBaixa(id: number, fetcher: typeof fetch = fetch): Promise<Operation> {
  const response = await fetcher(`/api/inventory/stock-decreases/${id}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (response.status === 401) throw new Error("Sessão expirada. Entre novamente e retome a mesma operação.");
  if (!response.ok) throw new Error("Operação indisponível para esta conta. Consulte o histórico.");
  const data: unknown = await response.json();
  if (!validOperation(data) || data.baixaId !== id) throw new Error("Resposta inválida da operação.");
  return data;
}
function outcome(data: Operation, message?: string): DecreaseResult {
  if (data.statusSincronizacao === "sincronizada") return { kind: "success", message: "Baixa confirmada. Atualizando inventário." };
  if (data.statusSincronizacao === "rejeitada") return { kind: "rejected", message: "Operação recusada ou cancelada. Confira os dados antes de registrar outra venda." };
  return { kind: "pending", message: message ?? "Operação sem confirmação. Solicite conferência; não registre esta venda novamente." };
}
export async function enviarBaixa(operation: PendingDecrease, fetcher: typeof fetch = fetch): Promise<DecreaseResult> {
  if (operation.baixaId === null) return { kind: "pending", message: recoveryMessage };
  try {
    const saved = await consultarBaixa(operation.baixaId, fetcher);
    if (saved.produtoId !== operation.produtoId || saved.varianteId !== operation.varianteId || saved.quantidade !== operation.quantidade) {
      return { kind: "pending", message: "Os dados não correspondem ao registro. Solicite conferência." };
    }
    if (saved.statusSincronizacao !== "registrada") return outcome(saved);
    const response = await fetcher(`/api/inventory/stock-decreases/${operation.baixaId}/execute`, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const data: unknown = await response.json().catch(() => null);
    if (validOperation(data) && data.baixaId === operation.baixaId && data.produtoId === operation.produtoId
      && data.varianteId === operation.varianteId && data.quantidade === operation.quantidade) {
      if (!response.ok && data.statusSincronizacao === "sincronizada") throw new Error();
      return outcome(data, "message" in data && typeof data.message === "string" ? data.message : undefined);
    }
    return { kind: "pending", needsLogin: response.status === 401, message: "Execução não confirmada. Consulte esta mesma operação pelo histórico." };
  } catch (error) { return { kind: "pending", message: error instanceof Error ? error.message : "Resultado não confirmado. Consulte o histórico." }; }
}
