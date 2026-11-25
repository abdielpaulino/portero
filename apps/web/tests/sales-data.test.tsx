import assert from "node:assert/strict";
import { it } from "node:test";
import { fetchSale, formatMoney, onlineTotals, type OnlineOrder } from "../src/app/sales/data";
const order: OnlineOrder = { id: "1", storeId: "123", numero: "7", origem: "nuvemshop", canal: "loja_online", criadoEm: "2026-11-01T03:00:00Z",
  status: "open", pagamento: "pending", moeda: "BRL", valorProdutos: "0.20", totalPedido: "10.20" };

it("totais online mantêm moedas separadas, deduplicam identidade composta e excluem cancelados", () => {
  const totals = onlineTotals([order, order, { ...order, id: "2", moeda: "USD" }, { ...order, id: "3", status: "cancelled" }, { ...order, id: "4", valorProdutos: null }]);
  assert.equal(totals.find(row => row.moeda === "BRL")!.valor, "0.20");
  assert.equal(totals.find(row => row.moeda === "BRL")!.incompletos, 1);
  assert.equal(totals.find(row => row.moeda === "USD")!.valor, "0.20");
  assert.equal(onlineTotals([{ ...order, storeId: "999" }, order])[0].pedidos, 2);
});
it("formatação não perde centavos acima do inteiro seguro e aceita recebido líquido negativo", () => {
  assert.equal(formatMoney("9999999999999999.99", "BRL"), "R$ 9.999.999.999.999.999,99");
  assert.equal(formatMoney("-10.05", "BRL"), "-R$ 10,05");
  assert.equal(formatMoney("-10.05", "USD"), "USD -10,05");
});
it("criação envia somente o registro local e mantém a chave recebida, sem credencial remota", async () => {
  const result = await fetchSale("", { method: "POST", headers: { "Idempotency-Key": "chave-local" }, body: "{}" }, async (url, init) => {
    assert.equal(url, "/api/sales/external"); assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "same-origin");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "chave-local"); assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({ id: 1, usuarioId: 1, origem: "portero", canal: "WhatsApp", situacao: "confirmada", moeda: "BRL", total: "10.00", valorRecebido: "0.00", valorEstornado: "0.00", itens: [], movimentos: [] });
  });
  assert.equal(result.id, 1);
});
it("resposta perdida ou incompleta não é tratada como venda confirmada", async () => {
  await assert.rejects(fetchSale("", {}, async () => { throw new Error("resposta perdida"); }));
  await assert.rejects(fetchSale("", {}, async () => Response.json({ id: 1 })), /inválida/);
});
