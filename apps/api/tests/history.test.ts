import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import type { LojaLogin } from "../src/auth/repository.js";
import { createSessionService, SESSION_COOKIE } from "../src/auth/session.js";
import { HISTORY_PAGE_SIZE, type StockHistoryItem } from "../src/inventory/history.js";

const secret = "segredo-offline-do-historico-com-mais-de-32-bytes";
const sensitive = "credencial-ficticia-nao-expor";
const item: StockHistoryItem = {
  id: 9, produtoId: "100", varianteId: "101",
  sku: "LUVA-9", quantidade: 2,
  status: "sincronizada", criadoEm: "2026-11-16T15:00:00.000Z",
  usuario: { id: 1, nome: "Ana", email: "ana@example.test" },
};

describe("histórico com sessão e banco simulados", { concurrency: false }, () => {
  const servers: Server[] = [];
  let base: string;
  let unconfiguredBase: string;
  let cookie: string;
  let secondCookie: string;
  let storesByUser: Map<number, LojaLogin[]>;
  let itemsByStore: Map<number, StockHistoryItem[]>;
  let checkedUsers: number[];
  let queries: { lojaId: number; page: number; pageSize: number }[];
  let failure: "association" | "history" | undefined;

  async function start(configured: boolean) {
    const server = createApp({
      jwtSecret: secret, environment: "production",
      repository: {
        async buscarUsuariosPorEmail() { throw new Error("O histórico não consulta senhas."); },
        async listarLojas(userId) {
          checkedUsers.push(userId);
          if (failure === "association") throw new Error(sensitive);
          return storesByUser.get(userId) ?? [];
        },
      },
      history: configured ? {
        async listar(lojaId, page, pageSize) {
          queries.push({ lojaId, page, pageSize });
          if (failure === "history") throw new Error(sensitive);
          return itemsByStore.get(lojaId) ?? [];
        },
      } : undefined,
    }).listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }

  before(async () => {
    base = await start(true);
    unconfiguredBase = await start(false);
    const sessions = createSessionService(secret);
    cookie = `${SESSION_COOKIE}=${await sessions.issue({ usuarioId: 1, lojaId: 10 })}`;
    secondCookie = `${SESSION_COOKIE}=${await sessions.issue({ usuarioId: 2, lojaId: 20 })}`;
  });

  beforeEach(() => {
    storesByUser = new Map([[1, [{ id: 10, nomeLoja: "Demo" }]], [2, [{ id: 20, nomeLoja: "Outra" }]]]);
    itemsByStore = new Map([[10, [{ ...item }]], [20, [{ ...item, id: 20, sku: "OUTRA-LOJA" }]]]);
    checkedUsers = []; queries = []; failure = undefined;
  });

  after(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
  });

  async function request(query = "", authCookie = cookie, target = base) {
    const response = await fetch(`${target}/inventory/stock-decreases${query}`, {
      headers: authCookie ? { Cookie: authCookie } : {},
    });
    const text = await response.text();
    assert.ok(!text.includes(sensitive));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, body: JSON.parse(text) };
  }

  it("exige sessão antes de consultar vínculos ou histórico", async () => {
    for (const authCookie of ["", `${SESSION_COOKIE}=invalido`]) {
      assert.equal((await request("", authCookie)).status, 401);
    }
    assert.deepEqual(checkedUsers, []);
    assert.deepEqual(queries, []);
  });

  it("revalida o vínculo e recusa associação ausente, trocada ou ambígua", async () => {
    for (const stores of [[], [{ id: 20, nomeLoja: "Outra" }],
      [{ id: 10, nomeLoja: "Demo" }, { id: 20, nomeLoja: "Outra" }]]) {
      storesByUser.set(1, stores);
      assert.equal((await request()).status, 403);
    }
    assert.deepEqual(checkedUsers, [1, 1, 1]);
    assert.deepEqual(queries, []);
  });

  it("consulta somente a loja da sessão e retorna autor, variante, data e resultado", async () => {
    const first = await request();
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, {
      items: [item], page: 1, hasMore: false,
    });
    const second = await request("?page=2", secondCookie);
    assert.equal(second.status, 200);
    assert.equal(second.body.items[0].sku, "OUTRA-LOJA");
    assert.deepEqual(queries, [
      { lojaId: 10, page: 1, pageSize: HISTORY_PAGE_SIZE },
      { lojaId: 20, page: 2, pageSize: HISTORY_PAGE_SIZE },
    ]);
    const serialized = JSON.stringify(first.body);
    for (const field of ["accessToken", "access_token", "senhaHash", "senha_hash", "lojaId"]) {
      assert.ok(!serialized.includes(field));
    }
  });

  it("recusa IDs, credenciais, parâmetros extras e páginas inválidas antes do banco", async () => {
    for (const query of ["?lojaId=20", "?usuarioId=2", "?access_token=falso", "?per_page=1", "?page=0",
      "?page=-1", "?page=1.5", "?page=01", "?page=", "?page=1&page=2", "?page[x]=1", "?page=1000000"]) {
      assert.equal((await request(query)).status, 400, query);
    }
    assert.deepEqual(checkedUsers, []);
    assert.deepEqual(queries, []);
  });

  it("usa o registro extra só para indicar a próxima página", async () => {
    itemsByStore.set(10, Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, index) => ({ ...item, id: index + 1 })));
    const result = await request("?page=3");
    assert.equal(result.status, 200);
    assert.equal(result.body.items.length, HISTORY_PAGE_SIZE);
    assert.equal(result.body.items.at(-1).id, HISTORY_PAGE_SIZE);
    assert.equal(result.body.hasMore, true);
    assert.equal(result.body.page, 3);
    itemsByStore.set(10, []);
    assert.deepEqual((await request("?page=4")).body, { items: [], page: 4, hasMore: false });
  });

  it("preserva resultados incertos e registros antigos sem inventar saldos", async () => {
    const uncertain = { ...item, sku: null, status: "incerta" };
    itemsByStore.set(10, [uncertain]);
    assert.deepEqual((await request()).body.items, [uncertain]);
  });

  it("trata configuração ausente e falhas do banco sem expor detalhes", async () => {
    assert.equal((await request("", cookie, unconfiguredBase)).status, 503);
    for (const stage of ["association", "history"] as const) {
      failure = stage;
      const result = await request();
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { message: "Não foi possível concluir a solicitação. Tente novamente." });
    }
  });
});
