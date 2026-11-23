import assert from "node:assert/strict";
import { once } from "node:events";
import { it } from "node:test";
import { hashSync } from "bcryptjs";
import { createApp } from "../src/app.js";
import { createNuvemshopRepository } from "../src/nuvemshop/repository.js";
import { createStockClient } from "../src/nuvemshop/stock.js";
import type { StockRecord, StockRepository } from "../src/stock/service.js";
import { pgFixture, prepared } from "./installation-fixture.js";

it("demo conectada: login, consultas do dashboard, baixa e histórico sem Redis e sem novo OAuth", async () => {
  const db = pgFixture([{ ...prepared("pendente"), access_token: "token-ficticio" }]);
  const installation = createNuvemshopRepository(db.pool);
  const records: StockRecord[] = []; // Persistência simulada; produção usa o repositório PostgreSQL.
  let remoteUpdates = 0;
  const stock: StockRepository = { async withLock(auth, target, work) {
    assert.equal(auth.lojaId, 8); assert.equal(auth.usuarioId, 1);
    const record = typeof target === "number" ? records.find(row => row.id === target) : undefined;
    return work({ store: { id: 8, nuvemshopStoreId: "123", accessToken: "token-ficticio" }, operation: record && { ...record },
      async hasUnresolved(except = 0) { return records.some(r => r.id !== except && r.statusSincronizacao !== "sincronizada"); },
      async create(command) {
        const row = { id: 1, usuarioId: 1, produtoId: command.produtoId, variantId: command.varianteId,
          quantidadeBaixada: command.quantidade, statusSincronizacao: "registrada" };
        records.push(row); return { ...row };
      },
      async prepare(id) { records.find(r => r.id === id)!.statusSincronizacao = "em_processamento"; },
      async status(id, status) { records.find(r => r.id === id)!.statusSincronizacao = status; },
    });
  } };
  const server = createApp({ jwtSecret: "segredo-ficticio-local-com-mais-de-32-bytes", webOrigin: "http://localhost:3000",
    verifyInstallation: () => installation.verificarInstalacao("123"),
    repository: {
      async buscarUsuariosPorEmail() { return [{ id: 1, nome: "Operador", email: "demo@example.test", senhaHash: hashSync("senha-local", 4) }]; },
      async listarLojas(userId) { return userId === 1 ? [{ id: 8, nomeLoja: "Demo" }] : []; },
    },
    inventory: { repository: { async listarLojas(userId) { assert.equal(userId, 1); return [{ id: 8, nuvemshopStoreId: "123", accessToken: "token-ficticio" }]; } },
      client: { async list() { return { items: [], page: 1, nextPage: null }; }, async get() { throw new Error("Consulta não esperada neste teste"); } } },
    history: { async listar(lojaId) { assert.equal(lojaId, 8); return records.map(r => ({ id: r.id, produtoId: r.produtoId, varianteId: r.variantId,
      sku: null, quantidade: r.quantidadeBaixada, status: r.statusSincronizacao, criadoEm: "2026-01-01T00:00:00Z", usuario: { id: 1, nome: "Operador", email: "demo@example.test" } })); } },
    stock: { storeId: "123", enabled: true, repository: stock, client: createStockClient("PORTERO (dev@example.test)", async (_url, init) => {
      const variant = { id: 101, product_id: 100, sku: "LUVA", stock: 8, stock_management: true };
      if (init?.method === "POST") { remoteUpdates++; return Response.json([{ ...variant, stock: 6 }]); }
      return Response.json(variant);
    }) },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(url + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ email: "demo@example.test", password: "senha-local" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().filter(value => value.startsWith("portero_session=")).at(-1)!.split(";")[0];
    const headers = { Cookie: cookie, "Content-Type": "application/json", Origin: "http://localhost:3000" };
    for (const path of ["/auth/session", "/inventory", "/inventory/stock-decreases"]) assert.equal((await fetch(url + path, { headers })).status, 200);
    const create = await fetch(url + "/inventory/stock-decreases", { method: "POST", headers, body: JSON.stringify({ produtoId: "100", varianteId: "101", quantidade: 2 }) });
    assert.equal(create.status, 201); assert.equal(remoteUpdates, 0);
    const id = (await create.json()).baixaId;
    const execute = () => fetch(url + `/inventory/stock-decreases/${id}/execute`, { method: "POST", headers, body: "{}" });
    assert.equal((await execute()).status, 200);
    assert.equal((await execute()).status, 200); assert.equal(remoteUpdates, 1);
    const history = await fetch(url + "/inventory/stock-decreases", { headers });
    assert.equal((await history.json()).items[0].status, "sincronizada");
    assert.ok(db.queries.every(q => q.text.startsWith("SELECT")));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
