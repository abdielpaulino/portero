import assert from "node:assert/strict";
import { it } from "node:test";
import { carregarSessao, encerrarSessao } from "../src/app/auth/session";

it("valida sessão no backend sem cache e preserva o cookie encaminhado pelo servidor", async () => {
  const session = { usuarioId: 1, loja: { id: 2, nomeLoja: "Demo" } };
  assert.deepEqual(await carregarSessao("http://api.local/auth/session", { headers: { Cookie: "portero_session=token" } }, async (url, init) => {
    assert.equal(url, "http://api.local/auth/session");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Cookie"), "portero_session=token");
    return Response.json(session);
  }), session);
});

it("recusa sessão expirada e não trata falha da API como sessão válida", async () => {
  for (const status of [401, 403]) assert.equal(await carregarSessao(undefined, {}, async () => new Response(null, { status })), null);
  await assert.rejects(carregarSessao(undefined, {}, async () => new Response(null, { status: 503 })), /verificar/);
  await assert.rejects(carregarSessao(undefined, {}, async () => Response.json({ usuarioId: 1 })), /inválida/);
});

it("logout envia POST com cookie e só conclui após resposta confirmada", async () => {
  await encerrarSessao(async (url, init) => {
    assert.equal(url, "/api/auth/logout");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "same-origin");
    return new Response(null, { status: 204 });
  });
  await assert.rejects(encerrarSessao(async () => new Response(null, { status: 503 })), /sair/);
});
