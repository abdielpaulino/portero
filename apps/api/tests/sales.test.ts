import assert from "node:assert/strict";
import { once } from "node:events";
import { it } from "node:test";
import { createApp } from "../src/app.js";
import { createSessionService } from "../src/auth/session.js";
import { createProductsClient } from "../src/nuvemshop/products.js";
import { createStockClient } from "../src/nuvemshop/stock.js";
import { inputBody, key, salesFixture } from "./sales-fixture.js";

async function fixture({ externalEnabled = true, stockEnabled = true } = {}) {
  const db = salesFixture(); const methods: string[] = []; let writes = 0;
  const product = { id: 100, name: { pt: "Luva" }, images: [], variants: [101, 102].map(id => ({ id, product_id: 100, values: [], sku: String(id), price: "9999.00", stock: 8, stock_management: true })) };
  let secondFails = false;
  let paused: Promise<void> | null = null;
  let entered!: () => void;
  const remoteEntered = new Promise<void>(resolve => { entered = resolve; });
  const stock = { storeId: "123", enabled: stockEnabled, repository: db.stock, client: createStockClient("PORTERO (test@example.test)", async (url, init) => {
    methods.push(init!.method!);
    if (paused) { entered(); await paused; }
    const id = init!.method === "POST" ? JSON.parse(init!.body as string).id : Number(String(url).split("/").at(-1));
    const variant = product.variants.find(variant => variant.id === id)!;
    if (init!.method === "POST") { writes++; if (id === 102 && secondFails) throw new Error("Resposta perdida após envio"); return Response.json([{ ...variant, stock: 8 + JSON.parse(init!.body as string).value }]); }
    return Response.json(variant);
  }) };
  const secret = "segredo-comercial-local-com-mais-de-32-bytes";
  const products = createProductsClient("PORTERO (test@example.test)", async (_url, init) => { methods.push(init!.method!); return Response.json(product); });
  const server = createApp({ jwtSecret: secret, repository: { async buscarUsuariosPorEmail() { return []; }, async listarLojas() { return [{ id: 10, nomeLoja: "Demo" }]; } },
    stock, sales: externalEnabled ? { repository: db.repository, products, stock } : undefined }).listen(0, "127.0.0.1");
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  const cookies = await Promise.all([1, 2].map(async usuarioId => `portero_session=${await createSessionService(secret).issue({ usuarioId, lojaId: 10 })}`));
  async function request(path = "", body?: unknown, requestKey = key, actor = 0) {
    const response = await fetch(`http://127.0.0.1:${port}/sales/external${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { ...(actor < 0 ? {} : { Cookie: cookies[actor] }), "Content-Type": "application/json", "Idempotency-Key": requestKey }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); assert.ok(!text.includes("token-ficticio")); return { status: response.status, data: JSON.parse(text) };
  }
  return { db, methods, request, stock, remoteEntered, async session() { const response = await fetch(`http://127.0.0.1:${port}/auth/session`, { headers: { Cookie: cookies[0] } }); assert.equal(response.status, 200); return response.json(); }, get writes() { return writes; }, failSecond() { secondFails = true; }, pause(value: Promise<void> | null) { paused = value; }, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

it("sessão informa a disponibilidade comercial independentemente da permissão de baixa", async () => {
  for (const externalEnabled of [true, false]) {
    const f = await fixture({ externalEnabled, stockEnabled: false });
    try {
      const session = await f.session(); assert.equal(session.baixasHabilitadas, false);
      assert.equal(session.vendasExternasHabilitadas, externalEnabled ? true : undefined);
      assert.equal(f.methods.length, 0); assert.equal(f.db.sales.length, 0);
      if (!externalEnabled) assert.equal((await f.request()).status, 503);
    } finally { await f.close(); }
  }
});

it("registro comercial preserva preços informados, não envia baixas nem cria pedidos e é idempotente", async () => {
  const f = await fixture(); try {
    const sale = await f.request("", inputBody); assert.equal(sale.status, 200); assert.equal(sale.data.total, "50.00");
    assert.equal(sale.data.itens[0].precoUnitario, "10.00"); assert.equal(sale.data.situacaoPagamento, "parcial");
    assert.equal(f.db.operations.length, 0); assert.ok(f.methods.every(method => method === "GET"));
    await Promise.all([f.request("", inputBody), f.request("", inputBody)]);
    assert.equal(f.db.sales.length, 1); assert.equal(f.methods.length, 1);
    assert.equal((await f.request("", { ...inputBody, canal: "Presencial" })).status, 409);
    assert.equal((await f.request("", inputBody, key, 1)).status, 403); assert.equal(f.db.sales.length, 1);
  } finally { await f.close(); }
});
it("API rejeita totais e vínculos fornecidos pelo cliente, NaN e valores monetários inválidos", async () => {
  const f = await fixture(); try {
    for (const value of [NaN, Infinity, null, "NaN", "Infinity", "-Infinity", "0.001", "-0.01", "10000000000000000.00", 10]) {
      assert.equal((await f.request("", { ...inputBody, itens: [{ ...inputBody.itens[0], precoUnitario: value }] })).status, 400);
      assert.equal((await f.request("", { ...inputBody, descontoVenda: value })).status, 400);
      assert.equal((await f.request("", { ...inputBody, pagamento: { ...inputBody.pagamento, valorRecebido: value } })).status, 400);
    }
    for (const fields of [{ total: "0.01" }, { usuarioId: 2 }, { lojaId: 99 }]) assert.equal((await f.request("", { ...inputBody, ...fields })).status, 400);
    assert.equal((await f.request("", { ...inputBody, itens: [{ ...inputBody.itens[0], total: "0.01" }] })).status, 400);
    assert.equal(f.db.sales.length, 0); assert.equal(f.writes, 0); assert.equal(f.methods.length, 0);
    await f.request("", inputBody);
    for (const value of ["NaN", "Infinity", "0.001", "-0.01", 10, null]) {
      assert.equal((await f.request("/1/financial-events", { tipo: "recebimento", valor: value, formaPagamento: "Pix", ocorridoEm: "2026-11-10T12:00:00Z" }, "22222222-2222-4222-8222-222222222222")).status, 400);
    }
    assert.equal(f.db.sales[0].movimentos.length, 1); assert.equal(f.writes, 0);
  } finally { await f.close(); }
});
it("resposta perdida da criação é recuperada pela chave sem gerar outra venda", async () => {
  const f = await fixture(); try {
    f.db.state.failCreateResponse = true; assert.equal((await f.request("", inputBody)).status, 503);
    f.db.state.failCreateResponse = false;
    assert.equal((await f.request(`/by-request/${key}`)).data.id, 1);
    assert.equal((await f.request("", inputBody)).data.id, 1); assert.equal(f.db.sales.length, 1); assert.equal(f.writes, 0);
  } finally { await f.close(); }
});
it("venda com vários itens mantém sucesso parcial, incerteza e reenvio seguro pelo mesmo ID", async () => {
  const f = await fixture(); try {
    const sale = (await f.request("", inputBody)).data;
    const first = await f.request(`/1/items/${sale.itens[0].id}/execute`, {}); assert.equal(first.status, 207); assert.equal(first.data.venda.estoque, "parcial");
    f.failSecond(); const second = await f.request(`/1/items/${sale.itens[1].id}/execute`, {});
    assert.equal(second.status, 502); assert.equal(second.data.venda.exigeConferencia, true); assert.equal(second.data.venda.valorRecebido, "5.00");
    await f.request(`/1/items/${sale.itens[0].id}/execute`, {}); await f.request(`/1/items/${sale.itens[1].id}/execute`, {});
    assert.equal(f.writes, 2); assert.equal(f.db.operations.length, 2);
    assert.equal(f.db.operations[0].statusSincronizacao, "sincronizada"); assert.equal(f.db.operations[1].statusSincronizacao, "incerta");
  } finally { await f.close(); }
});
it("perda da confirmação do vínculo impede envio e a retomada utiliza a baixa original", async () => {
  const f = await fixture(); try {
    const sale = (await f.request("", inputBody)).data; f.db.state.failPrepareResponse = true;
    assert.equal((await f.request(`/1/items/${sale.itens[0].id}/execute`, {})).status, 503); assert.equal(f.writes, 0);
    f.db.state.failPrepareResponse = false; await f.request(`/1/items/${sale.itens[0].id}/execute`, {});
    assert.equal(f.writes, 1); assert.equal(f.db.operations.length, 1);
  } finally { await f.close(); }
});
it("falha local após o desconto mantém a baixa em processamento e não envia outra redução", async () => {
  const f = await fixture(); try {
    const sale = (await f.request("", inputBody)).data;
    f.db.state.failFinalize = true;
    const failed = await f.request(`/1/items/${sale.itens[0].id}/execute`, {});
    assert.equal(failed.status, 503); assert.equal(failed.data.venda.exigeConferencia, true);
    assert.equal(failed.data.venda.itens[0].estoque, "em_processamento");
    f.db.state.failFinalize = false;
    assert.equal((await f.request(`/1/items/${sale.itens[0].id}/execute`, {})).status, 409);
    assert.equal(f.writes, 1); assert.equal(f.db.operations.length, 1);
  } finally { await f.close(); }
});
it("concorrência, vínculo e autor são conferidos antes da execução", async () => {
  const f = await fixture(); try {
    assert.equal((await f.request("", inputBody, key, -1)).status, 401);
    const sale = (await f.request("", inputBody)).data;
    let release!: () => void; f.pause(new Promise<void>(resolve => { release = resolve; }));
    const execution = f.request(`/1/items/${sale.itens[0].id}/execute`, {});
    await f.remoteEntered;
    assert.equal((await f.request(`/1/items/${sale.itens[0].id}/execute`, {})).status, 409);
    assert.equal((await f.request("/1/cancel", {}, key, 1)).status, 403);
    release(); f.pause(null); await execution;
    f.db.state.access = false; assert.equal((await f.request("/1")).status, 403);
  } finally { await f.close(); }
});
it("recebimentos e estornos são idempotentes; cancelamento mantém movimentos e não repõe estoque", async () => {
  const f = await fixture(); try {
    await f.request("", inputBody);
    const eventKey = "22222222-2222-4222-8222-222222222222";
    const event = { tipo: "recebimento", valor: "45.00", formaPagamento: "Dinheiro", ocorridoEm: "2026-11-10T12:00:00-03:00" };
    const paid = await f.request("/1/financial-events", event, eventKey); assert.equal(paid.data.situacaoPagamento, "pago");
    await f.request("/1/financial-events", event, eventKey); assert.equal(f.db.sales[0].movimentos.length, 2);
    assert.equal((await f.request("/1/financial-events", { ...event, valor: "44.00" }, eventKey)).status, 409);
    await f.request("/1/cancel", {}); assert.equal(f.db.sales[0].valorRecebido, "50.00");
    await f.request("/1/financial-events", { ...event, tipo: "estorno", valor: "10.00", ocorridoEm: "2026-12-01T12:00:00-03:00" }, "33333333-3333-4333-8333-333333333333");
    assert.equal(f.db.sales[0].valorEstornado, "10.00"); assert.equal(f.writes, 0); assert.equal(f.db.operations.length, 0);
  } finally { await f.close(); }
});
