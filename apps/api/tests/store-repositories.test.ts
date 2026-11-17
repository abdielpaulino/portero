import assert from "node:assert/strict";
import { after, before, beforeEach, it, mock } from "node:test";
import { Pool } from "pg";
import type { AuthRepository } from "../src/auth/repository.js";

let auth: AuthRepository;
let queries: { text: string; values: unknown[] }[];
const previousDatabaseUrl = process.env.DATABASE_URL;

before(async () => {
  process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/offline";
  mock.method(Pool.prototype, "query", async (config: { text: string }, values: unknown[]) => {
    queries.push({ text: config.text, values });
    return { rows: config.text.includes('"access_token"') ? [[10, "67890", "token-ficticio"]] : [[10, "Loja demo"]] };
  });
  auth = (await import("../src/auth/repository.js")).authRepository;
});

beforeEach(() => { queries = []; });
after(() => {
  mock.restoreAll();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

it("o login consulta diretamente a loja do usuário sem depender de tabela intermediária", async () => {
  assert.deepEqual(await auth.listarLojas(7), [{ id: 10, nomeLoja: "Loja demo" }]);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /from "usuarios_app" inner join "lojas"/);
  assert.match(queries[0].text, /"lojas"\."id" = "usuarios_app"\."loja_id"/);
  assert.match(queries[0].text, /where "usuarios_app"\."id" = \$1/);
  assert.deepEqual(queries[0].values, [7, 1]);
  assert.ok(!queries[0].text.includes("usuarios_lojas"));
  assert.ok(!queries[0].text.includes("access_token"));
});
