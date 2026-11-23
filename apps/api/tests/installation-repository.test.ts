import assert from "node:assert/strict";
import { it } from "node:test";
import { createNuvemshopRepository } from "../src/nuvemshop/repository.js";
import { pgFixture, prepared } from "./installation-fixture.js";
const loja = { nuvemshopStoreId: "123", accessToken: "token-ficticio", scope: "write_products", nomeLoja: "Demo" };
const attempt = { lojaId: 8, generation: prepared().generation, nonce: "a".repeat(64) };

it("demo original conectada valida PostgreSQL sem OAuth ou outro serviço", async () => {
  for (const status of ["pendente", "ativa"]) {
    const db = pgFixture([{ ...prepared(status), access_token: loja.accessToken }]);
    await createNuvemshopRepository(db.pool).verificarInstalacao("123");
    assert.equal(db.queries.length, 1);
    assert.ok(db.queries.every(q => q.text.startsWith("SELECT")));
  }
});
it("loja ausente, token vazio, estado encerrado ou loja diferente bloqueiam o acesso", async () => {
  for (const rows of [[], [prepared()], [{ ...prepared("desinstalada"), access_token: loja.accessToken }],
    [{ ...prepared("suspensa"), access_token: loja.accessToken }], [{ ...prepared("oauth_em_troca"), access_token: loja.accessToken }],
    [{ ...prepared("ativa"), access_token: loja.accessToken, nuvemshop_store_id: "999" }]]) {
    await assert.rejects(createNuvemshopRepository(pgFixture(rows).pool).verificarInstalacao("123"), { status: 409 });
  }
});
it("primeira instalação faz transições condicionais e somente UPDATE no registro preparado", async () => {
  const db = pgFixture(); const repo = createNuvemshopRepository(db.pool);
  assert.deepEqual(await repo.prepararAutorizacao("123"), { lojaId: 8, generation: attempt.generation });
  await repo.iniciarAutorizacao("123");
  assert.equal(db.rows()[0].status, "oauth_pendente");
  await repo.consumirAutorizacao("123", attempt);
  assert.equal(db.rows()[0].status, "oauth_em_troca");
  await repo.salvarLoja(loja, attempt);
  assert.equal(db.rows()[0].status, "ativa"); assert.equal(db.rows()[0].id, 8);
  await repo.verificarInstalacao("123");
  assert.ok(db.queries.every(q => !/\b(CREATE|ALTER|DROP|INSERT|DELETE)\b/.test(q.text)));
});
it("consumo confirmado não pode ser repetido por outra instância ou reinício", async () => {
  const db = pgFixture([prepared("oauth_pendente")]);
  await createNuvemshopRepository(db.pool).consumirAutorizacao("123", attempt);
  await assert.rejects(createNuvemshopRepository(db.pool).consumirAutorizacao("123", attempt), { status: 409 });
  await assert.rejects(createNuvemshopRepository(db.pool).iniciarAutorizacao("123"), { status: 409 });
});
it("callback antigo de outro registro ou geração não consome autorização", async () => {
  for (const candidate of [{ ...attempt, lojaId: 99 }, { ...attempt, generation: "outro" }]) {
    const db = pgFixture([prepared("oauth_pendente")]);
    await assert.rejects(createNuvemshopRepository(db.pool).consumirAutorizacao("123", candidate), { status: 409 });
    assert.equal(db.rows()[0].status, "oauth_pendente");
  }
});
it("falha ao salvar não libera outro OAuth nem reseta autorização consumida", async () => {
  const db = pgFixture([prepared("oauth_em_troca")], { fail: "UPDATE" });
  await assert.rejects(createNuvemshopRepository(db.pool).salvarLoja(loja, attempt));
  db.failQueries();
  assert.equal(db.rows()[0].status, "oauth_em_troca");
  await assert.rejects(createNuvemshopRepository(db.pool).iniciarAutorizacao("123"), { status: 409 });
});
it("resposta de commit perdida não autoriza um segundo consumo", async () => {
  const db = pgFixture([prepared("oauth_pendente")], { loseCommit: true });
  await assert.rejects(createNuvemshopRepository(db.pool).consumirAutorizacao("123", attempt));
  assert.equal(db.rows()[0].status, "oauth_em_troca");
  await assert.rejects(createNuvemshopRepository(db.pool).consumirAutorizacao("123", attempt), { status: 409 });
});
it("nenhum callback cria uma loja ausente ou reativa uma loja desinstalada", async () => {
  for (const rows of [[], [prepared("desinstalada")], [prepared("ativa")]]) {
    const db = pgFixture(rows); const repo = createNuvemshopRepository(db.pool);
    await assert.rejects(repo.iniciarAutorizacao("123"), { status: 409 });
    await assert.rejects(repo.consumirAutorizacao("123", attempt), { status: 409 });
    await assert.rejects(repo.salvarLoja(loja, attempt), { status: 409 });
    assert.deepEqual(db.rows(), rows);
  }
});
