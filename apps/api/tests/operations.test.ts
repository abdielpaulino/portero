import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { it } from "node:test";
import { compare } from "bcryptjs";
import { createApp } from "../src/app.js";
import { createInvitationRepository, invitationHash } from "../src/auth/invitations.js";
import { createSessionService } from "../src/auth/session.js";
import { createConferenceRepository, validateConference } from "../src/operations/conferences.js";
import { createSettingsRepository, createStockAlertSender, validateSettings, defaultSettings } from "../src/operations/settings.js";
import { operationsFixture } from "./operations-fixture.js";
import type { createProductsClient, InventoryItem } from "../src/nuvemshop/products.js";
const auth = { usuarioId: 1, lojaId: 10 }, secret = "segredo-ficticio-operacional-com-mais-32-bytes";
const evidence = { conclusao: "integral", quantidadeComprovada: 3, evidenciaTipo: "registro_movimentacao", evidenciaReferencia: "MOVIMENTO-123", justificativa: "Registro da plataforma conferido pela administração.", confirmoEvidencia: true };
it("convite armazena hash, vincula e-mail/loja e consumo simultâneo cria somente uma conta", async () => {
  const f = operationsFixture(), repo = createInvitationRepository(f.pool, "123");
  const invite = await repo.issue(" Felipe@EXAMPLE.TEST ");
  assert.equal(f.state.invites[0].email, "felipe@example.test"); assert.equal(f.state.invites[0].segredo_hash, invitationHash(invite.secret)); assert.notEqual(f.state.invites[0].segredo_hash, invite.secret);
  const results = await Promise.allSettled([repo.activate(invite.secret, "Felipe", "senha-longa-segura", "senha-longa-segura"), createInvitationRepository(f.pool, "123").activate(invite.secret, "Felipe", "senha-longa-segura", "senha-longa-segura")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state.users.length, 2);
  assert.equal(await compare("senha-longa-segura", f.state.users[1].senha_hash), true);
  await assert.rejects(repo.inspect(invite.secret), { status: 410 });
  assert.ok(!JSON.stringify(results).includes("senha-longa-segura"));
});
it("expiração, revogação, loja ausente e falha no consumo não alteram contas existentes", async () => {
  const f = operationsFixture(), repo = createInvitationRepository(f.pool, "123"), first = await repo.issue("felipe@example.test");
  const second = await repo.issue("felipe@example.test"); await assert.rejects(repo.inspect(first.secret), { status: 410 });
  f.state.now += 25 * 3600000; await assert.rejects(repo.inspect(second.secret), { status: 410 });
  const third = await repo.issue("felipe@example.test"); f.state.fail = "UPDATE convites_conta SET usado";
  await assert.rejects(repo.activate(third.secret, "Felipe", "senha-longa-segura", "senha-longa-segura")); assert.equal(f.state.users.length, 1); assert.equal(f.state.invites.at(-1)!.usado_em, null);
  f.state.fail = ""; f.state.active = false; await assert.rejects(repo.inspect(third.secret), { status: 403 });
  f.state.active = true; await assert.rejects(createInvitationRepository(f.pool, "999").inspect(third.secret), { status: 403 });
});
it("conferência exige documento, autoria da sessão e quantidade coerente; não aceita saldo como evidência", async () => {
  const f = operationsFixture(), repo = createConferenceRepository(f.pool, "123");
  assert.throws(() => validateConference({ ...evidence, evidenciaTipo: "saldo_atual" }), { status: 400 });
  assert.throws(() => validateConference({ ...evidence, saldoAtual: 3 }), { status: 400 });
  assert.throws(() => validateConference({ ...evidence, confirmoEvidencia: false }), { status: 400 });
  await assert.rejects(repo.resolve(auth, 7, randomUUID(), validateConference({ ...evidence, quantidadeComprovada: 2 })), { status: 400 });
  await assert.rejects(repo.resolve({ usuarioId: 1, lojaId: 20 }, 7, randomUUID(), validateConference(evidence)), { status: 403 });
  f.state.variantBusy = true; await assert.rejects(repo.resolve(auth, 7, randomUUID(), validateConference(evidence)), { status: 409 });
  assert.equal(f.state.reviews.length, 0); assert.equal(f.state.operation.status_sincronizacao, "incerta");
});
it("conferência é idempotente, registra responsável e rollback mantém a incerteza", async () => {
  const f = operationsFixture(), repo = createConferenceRepository(f.pool, "123"), key = randomUUID(), input = validateConference(evidence);
  f.state.fail = "UPDATE baixas_estoque SET status_sincronizacao";
  await assert.rejects(repo.resolve(auth, 7, key, input)); assert.equal(f.state.reviews.length, 0); assert.equal(f.state.operation.status_sincronizacao, "incerta");
  f.state.fail = ""; const results = await Promise.all([repo.resolve(auth, 7, key, input), createConferenceRepository(f.pool, "123").resolve(auth, 7, key, input)]);
  assert.equal(results[0].id, results[1].id); assert.equal(f.state.reviews.length, 1); assert.equal(f.state.reviews[0].usuario_id, 1); assert.equal(f.state.operation.status_sincronizacao, "sincronizada");
  await assert.rejects(repo.resolve(auth, 7, key, validateConference({ ...evidence, justificativa: "Outra referência para testar conflito de conteúdo." })), { status: 409 });
});
it("conclusão parcial preserva quantidade comprovada e inconclusiva mantém o bloqueio", async () => {
  const f = operationsFixture(), repo = createConferenceRepository(f.pool, "123");
  await repo.resolve(auth, 7, randomUUID(), validateConference({ ...evidence, conclusao: "inconclusiva", quantidadeComprovada: null }));
  assert.equal(f.state.operation.status_sincronizacao, "incerta");
  await repo.resolve(auth, 7, randomUUID(), validateConference({ ...evidence, conclusao: "parcial", quantidadeComprovada: 1 }));
  assert.equal(f.state.operation.status_sincronizacao, "conferida_parcial"); assert.equal(f.state.reviews.at(-1)!.quantidade_comprovada, 1);
  assert.ok(!f.queries.some(query => /INSERT INTO baixas_estoque/.test(query.text)));
});
it("preferências persistem com versão e isolamento, sem inicialização na leitura", async () => {
  const f = operationsFixture(), repo = createSettingsRepository(f.pool, f.pool, "123");
  assert.equal((await repo.get(auth)).versao, 0); assert.equal(f.state.settings, null);
  const input = validateSettings({ ...defaultSettings, limiteRuptura: 3, notificacoesAtivas: true, emailNotificacoes: "felipe@example.test" });
  const saved = await repo.save(auth, input); assert.equal(saved.versao, 1); assert.equal(saved.limiteRuptura, 3);
  await assert.rejects(repo.save(auth, input), { status: 409 });
  assert.equal((await createSettingsRepository(f.pool, f.pool, "123").get(auth)).limiteRuptura, 3);
  assert.throws(() => validateSettings({ ...input, limiteRuptura: NaN })); assert.throws(() => validateSettings({ ...input, intervaloSegundos: 1 }));
  await assert.rejects(repo.get({ usuarioId: 1, lojaId: 20 }), { status: 403 });
});
const item = (quantity: number | null): InventoryItem => ({ id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "Azul", sku: null, preco: 10, quantidade: quantity, ruptura: quantity !== null && quantity <= 0 });
it("alertas iniciais, recuperação e novo episódio não repetem envio entre instâncias", async () => {
  const f = operationsFixture(), repo = createSettingsRepository(f.pool, f.pool, "123");
  await repo.save(auth, { ...defaultSettings, notificacoesAtivas: true, emailNotificacoes: "felipe@example.test", limiteRuptura: 2 });
  let quantity: number | null = -1, emails = 0;
  const products = { async list() { return { items: [item(quantity)], nextPage: null, page: 1 }; }, async get() { throw new Error("Detalhes não devem ser consultados"); } };
  const sender = async () => { emails++; return "provedor-ficticio"; };
  await repo.monitor(products, sender); await createSettingsRepository(f.pool, f.pool, "123").monitor(products, sender); assert.equal(emails, 1);
  quantity = 3; await repo.monitor(products, sender); quantity = 2; await repo.monitor(products, sender); assert.equal(emails, 2);
  quantity = null; await repo.monitor(products, sender); assert.equal(emails, 2); assert.equal(f.state.alerts[0].abaixo_limite, false);
});
it("envio incerto ou confirmação local perdida não é repetido após reinício; concorrência é bloqueada", async () => {
  const f = operationsFixture(), repo = createSettingsRepository(f.pool, f.pool, "123");
  await repo.save(auth, { ...defaultSettings, notificacoesAtivas: true, emailNotificacoes: "felipe@example.test" });
  const products = { async list() { return { items: [item(0)], nextPage: null, page: 1 }; }, async get() { throw new Error("Detalhes não devem ser consultados"); } };
  let sends = 0, release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  const sender = async () => { sends++; entered(); await wait; throw new Error("resposta perdida"); };
  const pending = repo.monitor(products, sender); await ready;
  await assert.rejects(repo.monitor(products, sender), { status: 409 }); await assert.rejects(repo.save(auth, { ...defaultSettings, versao: 1 }), { status: 409 });
  release(); await pending; assert.equal(f.state.alerts[0].estado, "incerto");
  await createSettingsRepository(f.pool, f.pool, "123").monitor(products, sender); assert.equal(sends, 1);
  f.state.alerts[0].estado = "pendente"; f.state.fail = "UPDATE alertas_estoque SET estado='enviado'";
  await repo.monitor(products, async () => { sends++; return "provedor-ficticio"; }); f.state.fail = "";
  await repo.monitor(products, sender); assert.equal(sends, 2);
});
it("adaptador usa chave estável e texto sem credenciais; falha de envio não é confirmação", async () => {
  const payload = { evento_id: randomUUID(), destinatario: "felipe@example.test", nome_produto: "Luva", variante_id: "101", quantidade: -1, limite: 0 };
  const sender = createStockAlertSender({ RESEND_API_KEY: "credencial-ficticia", STOCK_ALERT_FROM_EMAIL: "portero@example.test" }, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), `stock/${payload.evento_id}`);
    assert.ok(!String(init?.body).includes("credencial-ficticia")); assert.match(String(init?.body), /Estoque negativo/); return Response.json({ id: "email-ficticio" });
  })!;
  assert.equal(await sender(payload), "email-ficticio");
  await assert.rejects(createStockAlertSender({ RESEND_API_KEY: "ficticio", STOCK_ALERT_FROM_EMAIL: "portero@example.test" }, async () => new Response("", { status: 500 }))!(payload));
});
it("monitoramento limita páginas, persiste cursor e informa abrangência parcial", async () => {
  const f = operationsFixture(), repo = createSettingsRepository(f.pool, f.pool, "123");
  await repo.save(auth, { ...defaultSettings, notificacoesAtivas: true, emailNotificacoes: "felipe@example.test" });
  const pages: number[] = [];
  const products = { async list(_store: unknown, page: number) { pages.push(page); return { items: [], nextPage: page < 4 ? page + 1 : null, page }; } } as unknown as ReturnType<typeof createProductsClient>;
  const first = await repo.monitor(products, async () => "nao-enviado"); assert.equal(first.proximaPagina, 4); assert.match(first.abrangencia!, /parcial/);
  const second = await createSettingsRepository(f.pool, f.pool, "123").monitor(products, async () => "nao-enviado");
  assert.deepEqual(pages, [1, 2, 3, 4]); assert.equal(second.proximaPagina, null); assert.equal(f.state.settings!.monitorProximaPagina, 1);
});
it("processo substituído perde a autorização persistente antes de gravar alertas ou iniciar envio", async () => {
  const f = operationsFixture(), repo = createSettingsRepository(f.pool, f.pool, "123");
  await repo.save(auth, { ...defaultSettings, notificacoesAtivas: true, emailNotificacoes: "felipe@example.test" });
  const products = { async list() { f.state.settings!.monitor_id = randomUUID(); return { items: [item(0)], nextPage: null, page: 1 }; }, async get() { throw new Error("Não consultar"); } };
  await assert.rejects(repo.monitor(products, async () => assert.fail("Processo antigo não envia e-mail")), { status: 409 });
  assert.equal(f.state.alerts.length, 0);
});
it("rotas exigem sessão/origem, convite não aceita loja/e-mail do cliente e desativação preserva o banco original", async () => {
  const f = operationsFixture(), invitations = createInvitationRepository(f.pool, "123"), invite = await invitations.issue("felipe@example.test");
  const app = createApp({ jwtSecret: secret, requireOrigin: true, webOrigin: "https://web.example.test", repository: { async buscarUsuariosPorEmail() { return []; }, async listarLojas() { return []; } },
    invitations, conferences: createConferenceRepository(f.pool, "123"), settings: { repository: createSettingsRepository(f.pool, f.pool, "123"), products: {} as ReturnType<typeof createProductsClient> } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  const cookie = `portero_session=${await createSessionService(secret).issue(auth)}`;
  try {
    assert.equal((await fetch(base + "/settings")).status, 401);
    assert.equal((await fetch(base + "/inventory/stock-decreases/7/reviews")).status, 401);
    const send = (path: string, body: unknown, origin = "https://web.example.test") => fetch(base + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await send("/auth/invitations/inspect", { codigo: invite.secret }, "https://outra.example.test")).status, 403);
    assert.equal((await send("/auth/invitations/inspect", { codigo: invite.secret, lojaId: 20 })).status, 400);
    const inspected = await send("/auth/invitations/inspect", { codigo: invite.secret }); assert.equal(inspected.status, 200); assert.equal((await inspected.json()).email, "felipe@example.test");
    const failed = await send("/auth/invitations/activate", { codigo: invite.secret, nome: "Felipe", password: "senha-longa-segura", confirmation: "senha-longa-segura", email: "outro@example.test" }); assert.equal(failed.status, 400);
    const response = await send("/auth/invitations/activate", { codigo: invite.secret, nome: "Felipe", password: "senha-longa-segura", confirmation: "senha-longa-segura" }); assert.equal(response.status, 201); assert.ok(!(await response.text()).includes("senha-longa-segura"));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
