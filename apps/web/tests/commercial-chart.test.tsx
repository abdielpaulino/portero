import assert from "node:assert/strict";
import { it } from "node:test";
import { dailyCommercialSeries, chartMoney, chartPercentage } from "../src/app/dashboard/commercial-chart";
import { fetchSummary, type OnlineOrder } from "../src/app/sales/data";

const order: OnlineOrder = { id: "1", storeId: "123", numero: "1", origem: "nuvemshop", canal: "loja_online", criadoEm: "2026-11-01T03:00:00Z", status: "open", pagamento: "pending", moeda: "BRL", valorProdutos: "0.20", totalPedido: "10.20" };
it("agrupa por data de São Paulo e moeda, exclui cancelados e usa preço histórico sem frete", () => {
  const data = dailyCommercialSeries("2026-11", [{ dia: "2026-11-01", moeda: "BRL", valor: "50.10" }, { dia: "2026-11-01", moeda: "USD", valor: "2.00" }], [order, order,
    { ...order, id: "2", moeda: "USD", valorProdutos: "0.10" }, { ...order, id: "3", status: "cancelled", valorProdutos: "999.00" },
    { ...order, id: "4", criadoEm: "2026-11-01T02:59:59Z", valorProdutos: "888.00" },
    { ...order, id: "5", criadoEm: "2026-12-01T02:59:59Z", valorProdutos: "0.30" },
    { ...order, id: "6", criadoEm: "2026-12-01T03:00:00Z", valorProdutos: "777.00" }]);
  const brl = data.series.find(group => group.moeda === "BRL")!, usd = data.series.find(group => group.moeda === "USD")!;
  assert.equal(brl.dias.length, 30); assert.equal(chartMoney(brl.dias[0].externas!), "50.10"); assert.equal(chartMoney(brl.dias[0].online!), "0.20");
  assert.equal(chartMoney(brl.dias[29].online!), "0.30"); assert.equal(chartMoney(usd.dias[0].externas!), "2.00"); assert.equal(chartMoney(usd.dias[0].online!), "0.10");
  assert.equal(data.series.length, 2); assert.equal(data.incompletos, 0);
});
it("preserva centavos acima do inteiro seguro e usa Number somente na proporção visual", () => {
  const data = dailyCommercialSeries("2026-11", [{ dia: "2026-11-01", moeda: "BRL", valor: "9999999999999999.99" }, { dia: "2026-11-01", moeda: "BRL", valor: "0.01" }], []);
  const amount = data.series[0].dias[0].externas!;
  assert.equal(chartMoney(amount), "10000000000000000.00"); assert.equal(chartPercentage(amount, amount), 100); assert.equal(chartPercentage(BigInt(0), BigInt(0)), 0);
});
it("ausência da série não vira zero; dados incompletos são excluídos e identificados", () => {
  const data = dailyCommercialSeries("2026-11", undefined, [order, { ...order, id: "2", valorProdutos: null }, { ...order, id: "3", moeda: null }]);
  assert.equal(data.series[0].dias[0].externas, null); assert.equal(chartMoney(data.series[0].dias[0].online!), "0.20"); assert.equal(data.incompletos, 2);
  const externalOnly = dailyCommercialSeries("2026-11", [{ dia: "2026-11-01", moeda: "BRL", valor: "1.00" }], undefined);
  assert.equal(externalOnly.series[0].dias[0].online, null);
});
it("considera o horário de verão histórico e o número de dias do mês", () => {
  const data = dailyCommercialSeries("2018-11", [], [{ ...order, criadoEm: "2018-11-05T01:30:00Z" }]);
  assert.equal(chartMoney(data.series[0].dias.find(day => day.dia === "2018-11-04")!.online!), "0.20");
  const leap = dailyCommercialSeries("2024-02", [{ dia: "2024-02-29", moeda: "BRL", valor: "1.00" }], []);
  assert.equal(leap.series[0].dias.length, 29);
});
it("payload diário inválido é rejeitado; backend anterior continua sem inventar uma série", async context => {
  const summary = { periodo: "2026-11", totais: [], estoque: { pendentes: 0, incertas: 0 } };
  let payload: unknown = summary;
  context.mock.method(globalThis, "fetch", async () => Response.json(payload));
  assert.equal((await fetchSummary("2026-11")).diario, undefined);
  for (const row of [{ dia: "2026-11-31", moeda: "BRL", valor: "1.00" }, { dia: "2026-11-01", moeda: "BRL", valor: "NaN" }, { dia: "2026-11-01", moeda: "BRL", valor: "-1.00" }]) {
    payload = { ...summary, diario: [row] };
    await assert.rejects(fetchSummary("2026-11"), /diária/);
  }
});
