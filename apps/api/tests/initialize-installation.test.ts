import assert from "node:assert/strict";
import { it } from "node:test";
import { initializeFirstInstallation } from "../src/scripts/initialize-installation.js";
import { pgFixture, prepared } from "./installation-fixture.js";

it("preparação administrativa explícita cria apenas uma loja sem token e sem DDL", async () => {
  const db = pgFixture([]);
  await initializeFirstInstallation(db.pool, "123");
  assert.equal(db.rows().length, 1);
  assert.equal(db.rows()[0].access_token, "");
  assert.equal(db.rows()[0].status, "instalacao_inicializada");
  assert.ok(db.queries.every(q => !/\b(CREATE|ALTER|DROP|TRUNCATE|DELETE)\b/.test(q.text)));
  await assert.rejects(initializeFirstInstallation(db.pool, "123"));
  assert.equal(db.rows().length, 1);
});
it("registro existente, inclusive encerrado, nunca é substituído pela preparação", async () => {
  for (const status of ["pendente", "ativa", "desinstalada", "suspensa", "oauth_em_troca"]) {
    const rows = [prepared(status)]; const db = pgFixture(rows);
    await assert.rejects(initializeFirstInstallation(db.pool, "123"));
    assert.deepEqual(db.rows(), rows);
  }
});
it("ID inválido não acessa banco e falha de gravação é revertida", async () => {
  const db = pgFixture([], { fail: "INSERT" });
  await assert.rejects(initializeFirstInstallation(db.pool, "../outro"));
  assert.equal(db.queries.length, 0);
  await assert.rejects(initializeFirstInstallation(db.pool, "123"));
  assert.deepEqual(db.rows(), []);
  assert.equal(db.queries.at(-1)?.text, "ROLLBACK");
});
