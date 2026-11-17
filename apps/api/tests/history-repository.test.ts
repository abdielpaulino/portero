import assert from "node:assert/strict";
import { after, before, beforeEach, it, mock } from "node:test";
import { Pool } from "pg";
import type { StockHistoryRepository } from "../src/inventory/history.js";

let repository: StockHistoryRepository;
let queries: { text: string; values: unknown[] }[];
let rows: unknown[][];
const previousDatabaseUrl = process.env.DATABASE_URL;

before(async () => {
  process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/offline";
  mock.method(Pool.prototype, "query", async (config: { text: string }, values: unknown[]) => {
    queries.push({ text: config.text, values });
    return { rows };
  });
  repository = (await import("../src/inventory/history-repository.js")).stockHistoryRepository;
});

beforeEach(() => {
  queries = [];
  rows = [[9, "100", "101", "LUVA-9", 2,
    "sincronizada", "2026-11-16T15:00:00.000Z", 1, "Ana", "ana@example.test"]];
});

after(() => {
  mock.restoreAll();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

it("limita o histórico à loja, busca um registro extra e mantém ordem estável", async () => {
  const result = await repository.listar(10, 3, 50);
  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.match(query.text, /from "baixas_estoque" inner join "usuarios_app"/);
  assert.match(query.text, /"usuarios_app"\."id" = "baixas_estoque"\."usuario_id"/);
  assert.match(query.text, /where "baixas_estoque"\."loja_id" = \$1/);
  assert.match(query.text, /order by "baixas_estoque"\."criado_em" desc, "baixas_estoque"\."id" desc limit \$2 offset \$3/);
  assert.deepEqual(query.values, [10, 51, 100]);
  assert.deepEqual(result, [{
    id: 9, produtoId: "100", varianteId: "101",
    sku: "LUVA-9", quantidade: 2, status: "sincronizada",
    criadoEm: "2026-11-16T15:00:00.000Z", usuario: { id: 1, nome: "Ana", email: "ana@example.test" },
  }]);
  assert.ok(!/requisicao_id|estoque_anterior|estoque_novo/.test(query.text));
  assert.ok(!query.text.includes("senha_hash"));
  assert.ok(!query.text.includes("access_token"));
  assert.ok(!query.text.includes('"lojas"'));
});

it("a primeira página não pula registros e aceita histórico vazio", async () => {
  rows = [];
  assert.deepEqual(await repository.listar(20, 1, 50), []);
  assert.deepEqual(queries[0].values, [20, 51]);
  assert.ok(!queries[0].text.includes("offset"));
});

it("preserva campos nulos de registros antigos e o status de falha", async () => {
  rows[0] = [9, "100", "101", null, 2, "incerta", "2026-11-16T15:00:00.000Z", 1, "Ana", "ana@example.test"];
  const [result] = await repository.listar(10, 1, 50);
  assert.ok(!("requisicaoId" in result));
  assert.equal(result.sku, null);
  assert.ok(!("estoqueAnterior" in result));
  assert.ok(!("estoqueNovo" in result));
  assert.equal(result.status, "incerta");
});
