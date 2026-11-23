import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { it, mock } from "node:test";
import { hashSync } from "bcryptjs";
import { Pool } from "pg";

it("composição publicada com as três flags false usa somente o banco original", async () => {
  const values = { NODE_ENV: "production", DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline?sslmode=require",
    JWT_SECRET: "segredo-ficticio-publicacao-com-mais-de-32-bytes", WEB_ORIGIN: "https://web.example.test", API_PUBLIC_URL: "https://api.example.test",
    NUVEMSHOP_STORE_ID: "123", NUVEMSHOP_USER_AGENT: "PORTERO (teste@example.test)", NUVEMSHOP_CLIENT_ID: "42", NUVEMSHOP_CLIENT_SECRET: "aplicativo-ficticio",
    STOCK_DECREASES_ENABLED: "false", EXTERNAL_SALES_ENABLED: "false", ONLINE_ORDERS_ENABLED: "false", VERCEL_ENV: "production",
    NUVEMSHOP_DEMO_STORE_ID: "", PORTERO_INSTALLATION_ID: "", INSTALLATION_ADMIN_TOKEN: "", RESEND_API_KEY: "", PRIVACY_FROM_EMAIL: "", PRIVACY_MERCHANT_EMAIL: "" };
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  const queries: string[] = [], nativeFetch = globalThis.fetch, password = hashSync("senha-ficticia", 4);
  let removed = false;
  const query = async (config: string | { text: string; rowMode?: string }) => {
    const sql = typeof config === "string" ? config : config.text;
    queries.push(sql);
    assert.doesNotMatch(sql, /(?:FROM|JOIN|INTO|UPDATE)\s+"?(?:vendas_externas|itens_venda_externa|movimentos_financeiros_venda)\b/i);
    if (sql.includes("to_regclass")) return { rows: [{ tabela: null }] };
    if (sql.includes("pg_try_advisory")) return { rows: [{ locked: true }] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
    if (sql.includes('from "usuarios_app"')) {
      if (sql.includes('join "lojas"')) return { rows: sql.includes('"access_token"') ? [[8, "123", "token-ficticio"]] : [[8, "Demo"]] };
      return { rows: [[1, "Operador", "operador@example.test", password]] };
    }
    if (sql.includes('from "baixas_estoque"')) return { rows: [] };
    if (sql.includes("FROM usuarios_app u JOIN lojas")) return { rows: [{ id: 8, nuvemshopStoreId: "123", accessToken: "token-ficticio" }] };
    if (sql.includes("FROM baixas_estoque")) return { rows: [{ id: 1, usuarioId: 1, produtoId: "100", variantId: "101", quantidadeBaixada: 1, statusSincronizacao: "registrada" }] };
    if (sql.includes("FROM lojas")) return { rows: removed ? [] : [{ id: 8, nuvemshop_store_id: "123", conectada: true, status: "ativa", generation: "1" }] };
    if (sql.startsWith("DELETE FROM lojas")) removed = true;
    return { rows: [], rowCount: 1 };
  };
  mock.method(Pool.prototype, "query", query);
  mock.method(Pool.prototype, "connect", async () => ({ query, on() {}, removeListener() {}, release() {} }));
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1:")) return nativeFetch(input, init);
    assert.equal(init?.method, "GET");
    assert.match(String(input), /^https:\/\/api\.nuvemshop\.com\.br\/2025-03\/123\/products\?/);
    return Response.json([]);
  };
  let server: import("node:http").Server | undefined;
  try {
    const app = (await import("../src/server.js")).default;
    assert.equal(queries.length, 0, "A composição não consulta a extensão no startup");
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(base + "/auth/login", { method: "POST", headers: { Origin: values.WEB_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "operador@example.test", password: "senha-ficticia" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().filter(value => value.startsWith("portero_session=")).at(-1)!.split(";")[0];
    const headers = { Cookie: cookie, Origin: values.WEB_ORIGIN, "Content-Type": "application/json" };
    const sessionResponse = await fetch(base + "/auth/session", { headers }); assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.baixasHabilitadas, false); assert.equal(session.vendasExternasHabilitadas, undefined); assert.equal(session.pedidosOnlineHabilitados, undefined);
    for (const path of ["/inventory", "/inventory/stock-decreases", "/inventory/stock-decreases/1"]) assert.equal((await fetch(base + path, { headers })).status, 200, path);
    for (const path of ["/sales/external", "/sales/external/summary", "/sales/online-orders"]) assert.equal((await fetch(base + path, { headers })).status, 503, path);
    for (const path of ["/inventory/stock-decreases", "/inventory/stock-decreases/1/execute", "/sales/external"]) assert.equal((await fetch(base + path, { method: "POST", headers, body: "{}" })).status, 503, path);
    const raw = JSON.stringify({ store_id: 123 });
    const result = await fetch(base + "/webhooks/nuvemshop/store-redact", { method: "POST", headers: { "Content-Type": "application/json", "x-linkedstore-hmac-sha256": createHmac("sha256", values.NUVEMSHOP_CLIENT_SECRET).update(raw).digest("hex") }, body: raw });
    assert.equal(result.status, 204);
    assert.ok(queries.some(sql => sql.includes("to_regclass")));
    assert.ok(queries.some(sql => sql.startsWith("DELETE FROM lojas")));
  } finally {
    globalThis.fetch = nativeFetch; mock.restoreAll();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
