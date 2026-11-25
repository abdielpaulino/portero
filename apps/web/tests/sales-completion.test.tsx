import assert from "node:assert/strict";
import { after, beforeEach, it } from "node:test";
import { completeSaleStock, inspectSaleStock, saleCompleted } from "../src/app/sales/completion";
import type { ExternalSale } from "../src/app/sales/data";

const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const key = "portero:venda:10:1:stock:1";
let stored: Record<string, string>, writes: number, failWrite: number;
const sale = (count = 2): ExternalSale => ({ id: 1, usuarioId: 1, requisicaoId: "11111111-1111-4111-8111-111111111111", origem: "portero", canal: "Presencial", formaPagamento: "Pix", moeda: "BRL", vendidaEm: "2026-11-01T12:00:00Z",
  situacao: "confirmada", situacaoPagamento: "pago", subtotal: "20.00", descontosItens: "0.00", descontoVenda: "0.00", total: "20.00", valorRecebido: "20.00", valorEstornado: "0.00", estoque: "pendente", exigeConferencia: false,
  itens: Array.from({ length: count }, (_, index) => ({ id: 100 + index, produtoId: String(100 + index), varianteId: String(200 + index), nomeProduto: "Luva", nomeVariante: "9", sku: "LUVA", quantidade: 1, precoUnitario: "10.00", desconto: "0.00", total: "10.00", baixaId: null, estoque: "nao_solicitada" })), movimentos: [] });
function apply(current: ExternalSale, itemId: number, state = "sincronizada") {
  const itens = current.itens.map(item => item.id === itemId ? { ...item, baixaId: item.id + 1000, estoque: state } : item);
  return { ...current, itens, estoque: itens.every(item => item.estoque === "sincronizada") ? "sincronizada" : "parcial" };
}
function response(current: ExternalSale, itemId: number, status = 207) {
  const item = current.itens.find(row => row.id === itemId)!;
  return Response.json({ venda: current, itemId, baixa: { baixaId: item.baixaId, statusSincronizacao: item.estoque } }, { status });
}
beforeEach(() => {
  stored = {}; writes = 0; failWrite = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent() { return true; }, localStorage: {
    getItem(name: string) { return stored[name] ?? null; },
    removeItem(name: string) { delete stored[name]; },
    setItem(name: string, value: string) { writes++; if (writes === failWrite) throw new Error("Armazenamento indisponível"); stored[name] = value; },
  } } });
});
after(() => { globalThis.fetch = originalFetch; if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window"); });

it("sem persistir os IDs e a intenção, nenhuma execução é enviada", async () => {
  let posts = 0; globalThis.fetch = async () => { posts++; throw new Error("Não deveria enviar"); };
  for (const failed of [1, 2]) {
    writes = 0; failWrite = failed; stored = {};
    await assert.rejects(completeSaleStock(sale(), key, () => {}), /Armazenamento/); assert.equal(posts, 0);
  }
});
it("falha ao guardar a resposta do primeiro item para os seguintes e a consulta permite recuperar sem repetir", async () => {
  let current = sale(); const sent: number[] = []; failWrite = 3;
  globalThis.fetch = async (url, init) => {
    if (!init?.method) return Response.json(current);
    const id = Number(String(url).split("/").at(-2)); sent.push(id); current = apply(current, id); return response(current, id);
  };
  await assert.rejects(completeSaleStock(current, key, () => {}), /Armazenamento/); assert.deepEqual(sent, [100]);
  assert.equal(JSON.parse(stored[key]).emEnvio, 100); failWrite = 0;
  const checked = await inspectSaleStock(sale(), key); assert.deepEqual(sent, [100]);
  const final = await completeSaleStock(checked, key, () => {}); assert.deepEqual(sent, [100, 101]); assert.ok(saleCompleted(final));
});
it("perda de resposta bloqueia execução posterior até uma consulta explícita, inclusive com estado antigo", async () => {
  let posts = 0; globalThis.fetch = async () => { posts++; throw new Error("Resposta perdida"); };
  await assert.rejects(completeSaleStock(sale(), key, () => {})); assert.equal(posts, 1);
  await assert.rejects(completeSaleStock(sale(), key, () => {}), /Confira/); assert.equal(posts, 1);
});
it("resposta de outro item, venda ou vínculo não comprova a execução", async () => {
  for (const wrong of ["sale", "item", "link", "quantity"]) {
    stored = {}; let posts = 0;
    globalThis.fetch = async () => {
      posts++; const current = apply(sale(), 100);
      if (wrong === "sale") current.id = 2;
      if (wrong === "quantity") current.itens[0].quantidade = 2;
      return Response.json({ venda: current, itemId: wrong === "item" ? 101 : 100, baixa: { baixaId: wrong === "link" ? 9999 : 1100, statusSincronizacao: "sincronizada" } });
    };
    await assert.rejects(completeSaleStock(sale(), key, () => {}), /não foi confirmada/); assert.equal(posts, 1); assert.equal(JSON.parse(stored[key]).emEnvio, 100);
  }
});
it("resposta não confirmada e estados incertos, recusados ou parciais nunca viram conclusão completa", async () => {
  for (const state of ["incerta", "em_processamento", "pendente", "rejeitada", "conferida_parcial"]) {
    let posts = 0; globalThis.fetch = async () => { posts++; throw new Error("Não deveria executar"); };
    const current = apply(sale(1), 100, state);
    assert.equal(saleCompleted({ ...current, estoque: "sincronizada" }), false);
    await completeSaleStock(current, key, () => {}); assert.equal(posts, 0);
  }
  assert.equal(saleCompleted({ ...sale(0), estoque: "sincronizada" }), false);
  assert.equal(saleCompleted({ ...apply(sale(1), 100), situacao: "cancelada" }), false);
});
