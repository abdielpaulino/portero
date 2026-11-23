import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import type { Pool } from "pg";
import { NuvemshopError } from "../src/nuvemshop/oauth.js";
import type { createWebhookRepository as Factory } from "../src/nuvemshop/webhook-repository.js";

let createRepository: typeof Factory;
const previous = process.env.DATABASE_URL;
before(async () => {
  process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/offline";
  createRepository = (await import("../src/nuvemshop/webhook-repository.js")).createWebhookRepository;
});
after(() => { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });

type Store = { id: number; nuvemshop_store_id: string; access_token: string; scope: string | null; status: string };
const store: Store = { id: 8, nuvemshop_store_id: "123", access_token: "token-ficticio", scope: "write_products", status: "pendente" };
function database(initial: Store[] = [store], options: {
  locked?: boolean; fail?: string; hang?: string; timeoutMs?: number; commercial?: boolean; operational?: boolean;
} = {}) {
  let rows = structuredClone(initial), snapshot = structuredClone(initial), released = false;
  let connections = 0;
  let rejectPending: ((error: Error) => void) | undefined;
  const releases: boolean[] = [];
  const queries: { text: string; values?: unknown[] }[] = [];
  const query = async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (options.fail && text.startsWith(options.fail)) throw new Error("detalhe-sensivel");
    if (options.hang && text.startsWith(options.hang)) return new Promise<never>((_resolve, reject) => { rejectPending = reject; });
    if (text === "BEGIN") snapshot = structuredClone(rows);
    if (text === "ROLLBACK") rows = snapshot;
    if (text.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: options.locked ?? true }] };
    if (text.includes("to_regclass('public.convites_conta')")) return { rows: [{ convites: options.operational ? "convites_conta" : null, conferencias: options.operational ? "conferencias_baixa" : null, configuracoes: options.operational ? "configuracoes_loja" : null }] };
    if (text.includes("to_regclass")) return { rows: [{ tabela: options.commercial ? "vendas_externas" : null }] };
    if (text.startsWith("SELECT id")) return { rows };
    if (text.startsWith("UPDATE lojas")) {
      for (const row of rows) if (row.id === values?.[0] && !(values?.[1] === "suspensa" && row.status === "desinstalada")) {
        row.access_token = ""; row.scope = null; row.status = String(values?.[1]);
      }
    }
    if (text.startsWith("DELETE FROM lojas")) rows = rows.filter(row => row.id !== values?.[0]);
    return { rows: [], rowCount: 1 };
  };
  const pool = { async connect() { connections++; return { query, release(destroy = false) {
    releases.push(destroy); released = true;
    if (destroy) { rows = structuredClone(snapshot); rejectPending?.(new Error("conexao-encerrada-sensivel")); }
  } }; } } as unknown as Pool;
  return { repository: createRepository(pool, options.timeoutMs), pool,
    connections: () => connections, queries, rows: () => rows, released: () => released, releases };
}

it("desinstalação apaga credenciais e desativa a integração sem apagar histórico ou estrutura", async () => {
  const db = database();
  await db.repository.handle("123", "app/uninstalled");
  assert.deepEqual(db.rows(), [{ ...store, access_token: "", scope: null, status: "desinstalada" }]);
  assert.match(db.queries[1].text, /pg_try_advisory_xact_lock\(7144630821938501::bigint\)/);
  assert.ok(db.queries.every(query => !/\b(CREATE|ALTER|DROP|TRUNCATE|DELETE)\b/.test(query.text)));
  assert.equal(db.queries.at(-1)?.text, "COMMIT");
  assert.equal(db.released(), true);
});
it("suspensão remove credenciais e não regride uma loja já desinstalada", async () => {
  for (const status of ["pendente", "desinstalada"]) {
    const db = database([{ ...store, status, ...(status === "desinstalada" ? { access_token: "", scope: null } : {}) }]);
    await db.repository.handle("123", "app/suspended");
    assert.deepEqual(db.rows(), [{ ...store, access_token: "", scope: null, status: status === "desinstalada" ? status : "suspensa" }]);
  }
});
it("redação da loja exclui dados relacionados na ordem das FKs e permite reentrega após reinício", async () => {
  const db = database();
  await db.repository.handle("123", "app/store_redact");
  assert.deepEqual(db.rows(), []);
  const deletions = db.queries.filter(query => query.text.startsWith("DELETE"));
  assert.deepEqual(deletions.map(query => query.text), [
    "DELETE FROM baixas_estoque WHERE loja_id = $1", "DELETE FROM usuarios_app WHERE loja_id = $1",
    "DELETE FROM acessos_permitidos WHERE loja_id = $1", "DELETE FROM lojas WHERE id = $1",
  ]);
  assert.ok(deletions.every(query => JSON.stringify(query.values) === "[8]"));
  const restarted = database([]);
  await restarted.repository.handle("123", "app/store_redact");
  assert.ok(restarted.queries.every(query => !/^(INSERT|UPDATE|DELETE)/.test(query.text)));
  assert.equal(restarted.queries.at(-1)?.text, "COMMIT");
});
it("loja inexistente aceita reentrega sem gravar registros para qualquer evento", async () => {
  const db = database([]);
  for (const event of ["app/uninstalled", "app/suspended", "app/store_redact"] as const) await db.repository.handle("123", event);
  assert.ok(db.queries.every(query => !/^(INSERT|UPDATE|DELETE)/.test(query.text)));
});
it("exclusão remove a extensão comercial antes das baixas, mesmo sem depender das flags de ativação", async () => {
  const db = database([store], { commercial: true });
  await db.repository.handle("123", "app/store_redact");
  const deletions = db.queries.filter(query => query.text.startsWith("DELETE"));
  assert.equal(deletions[0].text, "DELETE FROM vendas_externas WHERE loja_id = $1");
  assert.equal(deletions[1].text, "DELETE FROM baixas_estoque WHERE loja_id = $1");
  assert.equal(db.queries.at(-1)!.text, "COMMIT");
});
it("exclusão remove convites, evidências e preferências antes dos registros originais, mesmo com flags desativadas", async () => {
  const db = database([store], { commercial: true, operational: true });
  await db.repository.handle("123", "app/store_redact");
  assert.deepEqual(db.queries.filter(query => query.text.startsWith("DELETE")).map(query => query.text), [
    "DELETE FROM convites_conta WHERE loja_id = $1", "DELETE FROM conferencias_baixa WHERE loja_id = $1", "DELETE FROM configuracoes_loja WHERE loja_id = $1",
    "DELETE FROM vendas_externas WHERE loja_id = $1", "DELETE FROM baixas_estoque WHERE loja_id = $1", "DELETE FROM usuarios_app WHERE loja_id = $1", "DELETE FROM acessos_permitidos WHERE loja_id = $1", "DELETE FROM lojas WHERE id = $1",
  ]);
  assert.equal(db.queries.at(-1)!.text, "COMMIT");
});
it("recusa banco de outra loja, múltiplas lojas e lock ocupado sem alterar registros", async () => {
  for (const rows of [[{ ...store, nuvemshop_store_id: "999" }], [store, { ...store, id: 9, nuvemshop_store_id: "999" }]]) {
    const db = database(rows);
    await assert.rejects(db.repository.handle("123", "app/store_redact"), { status: 409 });
    assert.deepEqual(db.rows(), rows);
    assert.ok(db.queries.every(query => !/^(INSERT|UPDATE|DELETE)/.test(query.text)));
    assert.equal(db.queries.at(-1)?.text, "ROLLBACK");
  }
  const busy = database([store], { locked: false });
  await assert.rejects(busy.repository.handle("123", "app/uninstalled"), { status: 503 });
  assert.deepEqual(busy.rows(), [store]);
  assert.equal(busy.queries.length, 3);
});
it("falha durante exclusão desfaz a transação e não confirma sucesso nem expõe erro interno", async () => {
  const db = database([store], { fail: "DELETE FROM usuarios_app" });
  await assert.rejects(db.repository.handle("123", "app/store_redact"), error => {
    assert.ok(error instanceof Error && !error.message.includes("detalhe-sensivel"));
    assert.equal((error as { status?: number }).status, 503);
    return true;
  });
  assert.deepEqual(db.rows(), [store]);
  assert.equal(db.queries.at(-1)?.text, "ROLLBACK");
  assert.equal(db.released(), true);
});
it("falha ao adquirir conexão retorna indisponibilidade sem expor detalhes", async () => {
  const pool = { async connect() { throw new Error("credencial-sensivel"); } } as unknown as Pool;
  await assert.rejects(createRepository(pool).handle("123", "app/uninstalled"), error => {
    assert.equal((error as { status?: number }).status, 503);
    assert.ok(error instanceof Error && !error.message.includes("credencial-sensivel"));
    return true;
  });
});
it("prazo excedido destrói conexão com query pendente e impede continuação ou confirmação em segundo plano", async () => {
  const db = database([store], { hang: "DELETE FROM usuarios_app", timeoutMs: 20 });
  await assert.rejects(db.repository.handle("123", "app/store_redact"), error => {
    assert.equal((error as { status?: number }).status, 503);
    assert.ok(error instanceof Error && !error.message.includes("conexao-encerrada-sensivel"));
    return true;
  });
  assert.deepEqual(db.releases, [true]);
  assert.deepEqual(db.rows(), [store]);
  assert.ok(db.queries.every(query => query.text !== "COMMIT" && query.text !== "ROLLBACK"));
  assert.ok(db.queries.every(query => !query.text.startsWith("DELETE FROM acessos_permitidos") && !query.text.startsWith("DELETE FROM lojas")));
});


it("lock ocupado não confirma exclusão; nova entrega conclui o tratamento", async () => {
  const busy = database([store], { locked: false });
  await assert.rejects(busy.repository.handle("123", "app/store_redact"), { status: 503 });
  assert.deepEqual(busy.rows(), [store]);
  const retry = database(busy.rows());
  await retry.repository.handle("123", "app/store_redact");
  assert.deepEqual(retry.rows(), []);
});
