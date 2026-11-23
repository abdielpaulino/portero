import assert from "node:assert/strict";
import { it } from "node:test";
import { createNuvemshopRepository } from "../src/nuvemshop/repository.js";
import { createWebhookRepository } from "../src/nuvemshop/webhook-repository.js";
import { pgFixture, prepared } from "./installation-fixture.js";

const loja = { nuvemshopStoreId: "123", accessToken: "token-ficticio", scope: "write_products", nomeLoja: "Demo" };
const attempt = { lojaId: 8, generation: prepared().generation, nonce: "a".repeat(64) };
it("duas instâncias disputam início e consumo sem emitir duas permissões", async () => {
  const db = pgFixture();
  const first = createNuvemshopRepository(db.pool), second = createNuvemshopRepository(db.pool);
  const started = await Promise.allSettled([first.iniciarAutorizacao("123"), second.iniciarAutorizacao("123")]);
  assert.equal(started.filter(r => r.status === "fulfilled").length, 1);
  const consumed = await Promise.allSettled([first.consumirAutorizacao("123", attempt), second.consumirAutorizacao("123", attempt)]);
  assert.equal(consumed.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(db.rows()[0].status, "oauth_em_troca");
});
it("desinstalação e exclusão atrasadas não permitem salvar ou recriar a loja", async () => {
  const db = pgFixture([prepared("oauth_em_troca")]);
  const webhook = createWebhookRepository(db.pool), oauth = createNuvemshopRepository(db.pool);
  await webhook.handle("123", "app/uninstalled");
  assert.equal(db.rows()[0].status, "desinstalada");
  await assert.rejects(oauth.salvarLoja(loja, attempt), { status: 409 });
  await webhook.handle("123", "app/store_redact");
  assert.deepEqual(db.rows(), []);
  const restarted = createNuvemshopRepository(db.pool);
  await assert.rejects(restarted.iniciarAutorizacao("123"), { status: 409 });
  await assert.rejects(restarted.consumirAutorizacao("123", attempt), { status: 409 });
  await assert.rejects(restarted.salvarLoja(loja, attempt), { status: 409 });
  await createWebhookRepository(db.pool).handle("123", "app/store_redact");
  assert.deepEqual(db.rows(), []);
  assert.ok(db.queries.every(q => !q.text.startsWith("INSERT")));
});
it("exclusão concorre com gravação pelo mesmo lock; reentrega conclui e remove todos os dados", async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const db = pgFixture([prepared("oauth_em_troca")], { pausedUpdate: gate, onUpdate: () => entered() });
  const save = createNuvemshopRepository(db.pool).salvarLoja(loja, attempt);
  await ready;
  await assert.rejects(createWebhookRepository(db.pool).handle("123", "app/store_redact"), { status: 503 });
  release(); await save;
  assert.equal(db.rows()[0].status, "ativa");
  await createWebhookRepository(db.pool).handle("123", "app/store_redact");
  assert.deepEqual(db.rows(), []);
  await assert.rejects(createNuvemshopRepository(db.pool).salvarLoja(loja, attempt), { status: 409 });
  assert.deepEqual(db.queries.filter(q => q.text.startsWith("DELETE")).map(q => q.text.split(" ")[2]),
    ["baixas_estoque", "usuarios_app", "acessos_permitidos", "lojas"]);
});
