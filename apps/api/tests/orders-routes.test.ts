import assert from "node:assert/strict";
import { once } from "node:events";
import { it } from "node:test";
import { createApp } from "../src/app.js";
import { createSessionService } from "../src/auth/session.js";

it("consulta online exige sessão, deriva a loja no servidor e não oferece operações de escrita", async () => {
  const secret = "segredo-pedidos-simulados-com-mais-de-32-bytes"; let calls = 0;
  const server = createApp({ jwtSecret: secret, repository: { async buscarUsuariosPorEmail() { return []; }, async listarLojas() { return []; } }, orders: {
    repository: {
      async store(auth) { assert.deepEqual(auth, { usuarioId: 1, lojaId: 10 }); return { id: 10, nuvemshopStoreId: "123", accessToken: "token-ficticio" }; },
      async period(month) { assert.equal(month, "2026-11"); return { periodo: month, fuso: "America/Sao_Paulo", inicio: "2026-11-01T03:00:00Z", fim: "2026-12-01T03:00:00Z" }; },
    },
    client: { async list(store, period, page) { calls++; assert.equal(store.nuvemshopStoreId, "123"); return { ...period, page, items: [], totais: [], hasMore: false, recebidoNoMes: null, avisoRecebimentos: "Sem movimentos datados" }; } },
  } }).listen(0, "127.0.0.1");
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/sales/online-orders`;
  const cookie = `portero_session=${await createSessionService(secret).issue({ usuarioId: 1, lojaId: 10 })}`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base + "?periodo=2026-11&token=outro", { headers: { Cookie: cookie } })).status, 400);
    assert.equal(calls, 0);
    const result = await fetch(base + "?periodo=2026-11", { headers: { Cookie: cookie } }); assert.equal(result.status, 200);
    assert.ok(!(await result.text()).includes("token-ficticio")); assert.equal(calls, 1);
    assert.equal((await fetch(base, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" })).status, 404);
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
