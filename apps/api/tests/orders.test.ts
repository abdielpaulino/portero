import assert from "node:assert/strict";
import { it } from "node:test";
import { createOrdersClient } from "../src/nuvemshop/orders.js";
const store = { id: 10, nuvemshopStoreId: "123", accessToken: "token-ficticio" };
const period = { periodo: "2026-11", fuso: "America/Sao_Paulo", inicio: "2026-11-01T03:00:00.000Z", fim: "2026-12-01T03:00:00.000Z" };
const order = { id: 1, store_id: 123, number: 7, created_at: "2026-11-01T03:00:00Z", status: "open", payment_status: "pending", currency: "BRL", subtotal: "0.30", discount: "0.10", total: "10.20" };

it("pedidos são somente leitura, filtrados como loja online, com valores históricos sem frete", async () => {
  const result = await createOrdersClient("PORTERO (test@example.test)", async (url, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
    const query = new URL(String(url)); assert.equal(query.pathname, "/2025-03/123/orders"); assert.equal(query.searchParams.get("channels"), "store");
    assert.equal(query.searchParams.get("created_at_min"), period.inicio);
    assert.ok(!query.searchParams.get("fields")!.includes("customer"));
    return Response.json([order], { headers: { "x-total-count": "1" } });
  }).list(store, period, 1);
  assert.equal(result.items[0].valorProdutos, "0.20"); assert.equal(result.totais[0].valorPedidos, "0.20");
  assert.equal(result.totais[0].pagamentosPendentes, 1); assert.equal(result.recebidoNoMes, null);
});
it("não soma moedas, pedidos repetidos, cancelados ou valores incompletos como totais completos", async () => {
  const result = await createOrdersClient("PORTERO", async () => Response.json([order, order,
    { ...order, id: 2, currency: "USD" }, { ...order, id: 3, status: "cancelled" }, { ...order, id: 4, subtotal: null }])).list(store, period, 1);
  assert.equal(result.totais.find(row => row.moeda === "BRL")!.valorPedidos, "0.20");
  assert.equal(result.totais.find(row => row.moeda === "BRL")!.incompletos, 1);
  assert.equal(result.totais.find(row => row.moeda === "USD")!.valorPedidos, "0.20");
});
it("read_orders ausente, paginação remota indevida e outra loja não provocam escrita", async () => {
  await assert.rejects(createOrdersClient("PORTERO", async () => new Response(null, { status: 403 })).list(store, period, 1), /read_orders/);
  await assert.rejects(createOrdersClient("PORTERO", async () => Response.json([order], { headers: { link: '<https://outro.test/123/orders?page=2>; rel="next"' } })).list(store, period, 1));
  await assert.rejects(createOrdersClient("PORTERO", async () => Response.json([{ ...order, store_id: 999 }])).list(store, period, 1));
});
it("mantém limites do período e paginação sem inventar recebido pelo status pago", async () => {
  const result = await createOrdersClient("PORTERO", async () => Response.json([
    { ...order, id: 2, created_at: "2026-11-01T02:59:59Z" }, { ...order, payment_status: "paid" }], { headers: { "x-total-count": "51" } })).list(store, period, 1);
  assert.equal(result.items.length, 1); assert.equal(result.hasMore, true); assert.equal(result.recebidoNoMes, null);
});
