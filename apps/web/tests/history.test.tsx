import assert from "node:assert/strict";
import { it } from "node:test";
import { carregarHistorico, statusLabel, type StockHistoryItem } from "../src/app/history/data";

const item: StockHistoryItem = { id: 1, produtoId: "100", varianteId: "101",
  sku: "LUVA-9", quantidade: 2, status: "sincronizada",
  criadoEm: "2026-11-16T12:00:00.000Z", usuario: { id: 1, nome: "Equipe", email: "equipe@example.com" } };

it("consulta histórico real paginado na rota encaminhada com cookie e sem cache", async () => {
  assert.deepEqual(await carregarHistorico(2, undefined, async (url, init) => {
    assert.equal(url, "/api/inventory/stock-decreases?page=2");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return Response.json({ items: [item], page: 2, hasMore: false });
  }), { items: [item], page: 2, hasMore: false });
});

it("exibe estados sem confirmação como pendência de conferência", () => {
  assert.match(statusLabel("incerta"), /conferir/);
  assert.match(statusLabel("em_processamento"), /conferir/);
  assert.match(statusLabel("estado_antigo"), /conferir/);
  assert.doesNotMatch(statusLabel("estado_antigo"), /estado_antigo/);
  assert.equal(statusLabel("sincronizada"), "Confirmada");
});

it("distingue sessão expirada, falta de acesso e respostas incompletas do histórico", async () => {
  for (const [status, message] of [[401, /Sessão expirada/], [403, /acesso/], [503, /carregar/]] as const) {
    await assert.rejects(carregarHistorico(1, undefined, async () => new Response(null, { status })), message);
  }
  for (const body of [{ items: [{}], page: 1, hasMore: false }, { items: [item], page: 2, hasMore: false }]) {
    await assert.rejects(carregarHistorico(1, undefined, async () => Response.json(body)), /inválida/);
  }
});
