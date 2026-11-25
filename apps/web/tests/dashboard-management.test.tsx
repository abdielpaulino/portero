import assert from "node:assert/strict";
import { it } from "node:test";
import { dashboardFigures, formatUnits, sumMoney } from "../src/app/dashboard/management";
import { dailyCommercialSeries } from "../src/app/dashboard/commercial-chart";
import { fetchSummary, type DashboardSummary, type OnlineOrder } from "../src/app/sales/data";

const summary: DashboardSummary = { periodo: "2026-11", fuso: "America/Sao_Paulo", inicio: "2026-11-01T03:00:00Z", fim: "2026-12-01T03:00:00Z",
  totais: [{ moeda: "BRL", canal: "WhatsApp", vendas: 3, valorVendido: "1500.00", recebimentos: "700.00", estornos: "50.00", recebidoLiquido: "650.00", pagamentosPendentes: 2 }], estoque: { pendentes: 3, incertas: 1 },
  gestao: { porMoeda: [{ moeda: "BRL", valorAReceber: "900.00", unidades: "8" }], produtosMaisVendidos: [{ moeda: "BRL", produtoId: "100", nome: "Luva", unidades: "8" }], vendasComPendencia: 2 } };
const order: OnlineOrder = { id: "1", storeId: "123", numero: "1", origem: "nuvemshop", canal: "loja_online", criadoEm: "2026-11-01T03:00:00Z", status: "open", pagamento: "pending", moeda: "BRL", valorProdutos: "200.00", totalPedido: "220.00" };
it("valor comercial separa moedas e não confunde pedidos pendentes, recebimentos e saldo de vendas do mês", () => {
  const result = dashboardFigures(summary, [order, order, { ...order, id: "2", status: "cancelled", valorProdutos: "999.00" }, { ...order, id: "3", moeda: "USD", valorProdutos: "20.00" }], true, "BRL", "2026-11");
  assert.equal(result.sold, "1700.00"); assert.equal(result.received, "650.00"); assert.equal(result.outstanding, "900.00"); assert.equal(result.units, "8");
  assert.equal(result.externalSales, 3); assert.equal(result.onlineOrders, 1); assert.equal(result.count, 4);
  assert.equal(result.channels?.[0].valor, "1500.00"); assert.equal(result.ranking?.[0].unidades, "8");
  assert.equal(dashboardFigures(summary, [order, { ...order, id: "3", moeda: "USD", valorProdutos: "20.00" }], true, "USD", "2026-11").sold, "20.00");
});
it("dados ausentes e backend anterior não são zero; períodos comprovadamente vazios são zero", () => {
  const missing = dashboardFigures(null, [], false, "BRL", "2026-11");
  for (const key of ["sold", "received", "outstanding", "units", "count", "ranking"] as const) assert.equal(missing[key], null);
  const legacy = { ...summary }; delete legacy.gestao;
  const old = dashboardFigures(legacy, [], true, "BRL", "2026-11"); assert.equal(old.outstanding, null); assert.equal(old.units, null); assert.equal(old.ranking, null); assert.equal(old.received, "650.00");
  const empty = dashboardFigures({ ...summary, totais: [], gestao: { porMoeda: [], produtosMaisVendidos: [], vendasComPendencia: 0 } }, [], true, "BRL", "2026-11");
  assert.equal(empty.sold, "0.00"); assert.equal(empty.outstanding, "0.00"); assert.equal(empty.units, "0"); assert.equal(empty.count, 0);
});
it("datas brasileiras respeitam limites mensais de São Paulo e dados incompletos continuam identificados", () => {
  const result = dashboardFigures(null, [{ ...order, criadoEm: "2026-11-01T02:59:59Z" }, { ...order, id: "2", criadoEm: "2026-12-01T02:59:59Z" }, { ...order, id: "3", criadoEm: "2026-12-01T03:00:00Z" }], true, "BRL", "2026-11");
  assert.equal(result.sold, "200.00"); assert.equal(result.onlineOrders, 1);
  const missing = dashboardFigures(null, [{ ...order, valorProdutos: null }], true, "BRL", "2026-11"); assert.equal(missing.sold, null); assert.equal(missing.incomplete, true);
  const unknownCurrency = dashboardFigures(null, [{ ...order, moeda: null }], true, "BRL", "2026-11"); assert.equal(unknownCurrency.sold, null); assert.equal(unknownCurrency.onlineOrders, null);
  const unknownDate = dashboardFigures(null, [{ ...order, criadoEm: "invalid" }], true, "BRL", "2026-11"); assert.equal(unknownDate.sold, null); assert.equal(unknownDate.incomplete, true);
});
it("gráfico não transforma um dia com somente valores ausentes em zero nem conecta a lacuna", () => {
  const result = dailyCommercialSeries("2026-11", [], [{ ...order, valorProdutos: null }]);
  assert.equal(result.series[0].dias[0].online, null); assert.equal(result.series[0].dias[0].incompletos, 1);
  const partial = dailyCommercialSeries("2026-11", [], [order, { ...order, id: "2", valorProdutos: null }]);
  assert.equal(partial.series[0].dias[0].online, BigInt(20000)); assert.equal(partial.incompletos, 1);
});
it("recebido líquido negativo e valores acima do inteiro seguro continuam exatos", () => {
  assert.equal(sumMoney(["9999999999999999.99", "0.02"]), "10000000000000000.01");
  assert.equal(sumMoney(["-0.05", "-10.00"]), "-10.05"); assert.equal(sumMoney(["NaN"]), null);
  assert.equal(formatUnits("9007199254740993"), "9.007.199.254.740.993");
});
it("valida os novos agregados sem exigir sua presença no backend anterior", async () => {
  const original = globalThis.fetch;
  try {
    for (const gestao of [null, { ...summary.gestao, porMoeda: [{ moeda: "BRL", valorAReceber: "NaN", unidades: "1" }] }, { ...summary.gestao, vendasComPendencia: -1 }, { ...summary.gestao, produtosMaisVendidos: [{ moeda: "BRL", produtoId: "100", nome: "Luva", unidades: "1.5" }] }]) {
      globalThis.fetch = async () => Response.json({ ...summary, gestao }); await assert.rejects(fetchSummary("2026-11"), /Indicadores indisponíveis/);
    }
    globalThis.fetch = async () => Response.json(summary); assert.equal((await fetchSummary("2026-11")).gestao?.porMoeda[0].valorAReceber, "900.00");
    for (const vendas of [NaN, -1, null, "3", 1.5]) {
      globalThis.fetch = async () => Response.json({ ...summary, totais: [{ ...summary.totais[0], vendas }] });
      await assert.rejects(fetchSummary("2026-11"), /Resumo comercial inválido/);
    }
  } finally { globalThis.fetch = original; }
});
