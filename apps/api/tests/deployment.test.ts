import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, it } from "node:test";
import { hashSync } from "bcryptjs";
import { createApp } from "../src/app.js";
import { NuvemshopError } from "../src/nuvemshop/oauth.js";
import { createSessionService, SESSION_COOKIE } from "../src/auth/session.js";

const webOrigin = "https://web.example.test", apiOrigin = "https://api.example.test";
const secret = "segredo-ficticio-exclusivo-producao-32-bytes";
const servers: Server[] = [];
let base: string, demo: string, mismatch: boolean, queries: number;
async function start(jwtSecret: string) {
  const server = createApp({ jwtSecret, environment: "production", secureCookies: true, requireOrigin: true, webOrigin, apiOrigin,
    verifyInstallation: async () => { if (mismatch) throw new NuvemshopError(409, "Banco de outra instalação"); },
    repository: {
      async buscarUsuariosPorEmail() { queries++; return [{ id: 1, nome: "Felipe", email: "felipe@example.test", senhaHash: hashSync("senha-ficticia", 4) }]; },
      async listarLojas() { return [{ id: 8, nomeLoja: "Loja real" }]; },
    },
    stock: { storeId: "123", enabled: false, client: { async read() { throw new Error("Não deve consultar estoque remoto"); }, async update() { throw new Error(); } },
      repository: { async withLock() { throw new Error("Baixa desabilitada não acessa operações"); } } },
  }).listen(0, "127.0.0.1");
  servers.push(server); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
before(async () => { base = await start(secret); demo = await start("segredo-ficticio-diferente-apenas-da-demo-32-bytes"); });
beforeEach(() => { mismatch = false; queries = 0; });
after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function post(path: string, origin: string | undefined = webOrigin, cookie = "") {
  return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(path === "/auth/login" ? { email: "felipe@example.test", password: "senha-ficticia" } : {}) });
}

it("login e logout em produção usam cookie seguro, sem Domain, e revalidam sessão pelo backend", async () => {
  const response = await post("/auth/login"); assert.equal(response.status, 200);
  const header = response.headers.getSetCookie().filter(value => value.startsWith(SESSION_COOKIE + "=")).at(-1)!;
  assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=Lax/); assert.ok(!/Domain=/i.test(header));
  const cookie = header.split(";")[0];
  const session = await fetch(base + "/auth/session", { headers: { Cookie: cookie } });
  assert.equal(session.status, 200); assert.equal((await session.json()).baixasHabilitadas, false);
  assert.equal((await fetch(demo + "/auth/session", { headers: { Cookie: cookie } })).status, 401);
  const logout = await post("/auth/logout", webOrigin, cookie); assert.equal(logout.status, 204);
  assert.match(logout.headers.getSetCookie()[0], /portero_session=;/);
});
it("origens ausentes ou diferentes impedem login antes de consultar o usuário", async () => {
  const withoutOrigin = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(withoutOrigin.status, 403);
  assert.equal((await post("/auth/login", "https://outra.example.test")).status, 403);
  assert.equal(queries, 0);
});
it("recusa banco de outra loja antes de autenticar ou consultar operações", async () => {
  mismatch = true;
  assert.equal((await post("/auth/login")).status, 409); assert.equal(queries, 0);
  for (const path of ["/inventory", "/inventory/stock-decreases", "/auth/session"])
    assert.equal((await fetch(base + path)).status, 409);
});
it("logout remove o cookie mesmo quando a instalação está indisponível", async () => {
  mismatch = true;
  const cookie = `${SESSION_COOKIE}=${await createSessionService(secret).issue({ usuarioId: 1, lojaId: 8 })}`;
  const response = await post("/auth/logout", webOrigin, cookie);
  assert.equal(response.status, 204);
  assert.match(response.headers.getSetCookie()[0], /portero_session=;/);
  assert.equal(queries, 0);
});
it("bloqueio de baixas cobre criação, execução e execução com barra final", async () => {
  const cookie = `${SESSION_COOKIE}=${await createSessionService(secret).issue({ usuarioId: 1, lojaId: 8 })}`;
  for (const path of ["/inventory/stock-decreases", "/inventory/stock-decreases/1/execute", "/inventory/stock-decreases/1/execute/"])
    assert.equal((await post(path, webOrigin, cookie)).status, 503);
});
it("webhook em produção valida o corpo bruto acima de 8kb sem Origin ou verificação de instalação", async () => {
  const clientSecret = "segredo-ficticio-do-aplicativo-webhook";
  const received: { storeId: string; event: string }[] = [];
  let installationChecks = 0;
  const server = createApp({ jwtSecret: secret, secureCookies: true, requireOrigin: true, webOrigin, apiOrigin,
    repository: {
      async buscarUsuariosPorEmail() { throw new Error("Webhook não consulta usuários"); },
      async listarLojas() { throw new Error("Webhook não consulta sessão"); },
    },
    verifyInstallation: async () => { installationChecks++; throw new Error("Instalação indisponível"); },
    webhooks: { storeId: "123", clientId: "42", clientSecret,
      repository: { async handle(storeId, event) { received.push({ storeId, event }); } } },
  }).listen(0, "127.0.0.1");
  servers.push(server); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const body = JSON.stringify({ store_id: 123, id: 42, event: "app/uninstalled", padding: "x".repeat(12_000) }, null, 2);
  assert.ok(Buffer.byteLength(body) > 8 * 1024);
  const signature = createHmac("sha256", clientSecret).update(body).digest("hex");
  const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/nuvemshop/uninstalled`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-linkedstore-hmac-sha256": signature }, body,
  });
  assert.equal(response.status, 204);
  assert.deepEqual(received, [{ storeId: "123", event: "app/uninstalled" }]);
  assert.equal(installationChecks, 0);
});
it("limites distribuídos foram removidos e não são simulados por memória local", async () => {
  for (let i = 0; i < 11; i++) assert.equal((await post("/auth/login")).status, 200);
  assert.equal(queries, 11);
});
