import assert from "node:assert/strict";
import { it } from "node:test";
import { readRuntime } from "../src/runtime.js";
const local = { NODE_ENV: "development", NUVEMSHOP_STORE_ID: "456", NUVEMSHOP_USER_AGENT: "PORTERO (dev@example.test)" };
const production = { ...local, NODE_ENV: "production", VERCEL_ENV: "production",
  WEB_ORIGIN: "https://web.example.test", API_PUBLIC_URL: "https://api.example.test",
  NUVEMSHOP_CLIENT_ID: "123", NUVEMSHOP_CLIENT_SECRET: "ficticio" };
it("demo conectada funciona sem Redis nem credenciais administrativas do OAuth", () => {
  const runtime = readRuntime(local);
  assert.deepEqual(runtime.integration, { storeId: "456", userAgent: local.NUVEMSHOP_USER_AGENT });
  assert.equal(runtime.nuvemshop, undefined);
  assert.equal(runtime.stockEnabled, false);
  assert.equal(readRuntime({ ...local, STOCK_DECREASES_ENABLED: "true" }).stockEnabled, true);
});
it("compatibilidade com ID antigo da demo é apenas local", () => {
  assert.equal(readRuntime({ ...local, NUVEMSHOP_STORE_ID: "", NUVEMSHOP_DEMO_STORE_ID: "456" }).integration.storeId, "456");
  assert.throws(() => readRuntime({ ...production, NUVEMSHOP_DEMO_STORE_ID: "456" }));
});
it("produção dispensa Redis e exige identidade da loja e assinatura dos webhooks", () => {
  assert.equal(readRuntime(production).webhooks?.storeId, "456");
  for (const change of [{ NUVEMSHOP_STORE_ID: "" }, { NUVEMSHOP_CLIENT_SECRET: "" }, { VERCEL_ENV: "preview" },
    { WEB_ORIGIN: "http://web.example.test" }, { STOCK_DECREASES_ENABLED: "sim" }])
    assert.throws(() => readRuntime({ ...production, ...change }));
});
it("OAuth é habilitado somente com todas as configurações administrativas", () => {
  assert.equal(readRuntime(production).nuvemshop, undefined);
  assert.ok(readRuntime({ ...production, PORTERO_INSTALLATION_ID: "instalacao-real", INSTALLATION_ADMIN_TOKEN: "administrativo-exclusivo-maior-que-32-bytes" }).nuvemshop);
});
it("o IP local específico é aceito apenas em desenvolvimento, sem liberar outras origens HTTP", () => {
  assert.equal(readRuntime({ ...local, WEB_ORIGIN: "http://192.168.3.7:3000" }).webOrigin, "http://192.168.3.7:3000");
  assert.throws(() => readRuntime({ ...local, WEB_ORIGIN: "http://192.168.3.8:3000" }));
  assert.throws(() => readRuntime({ ...production, WEB_ORIGIN: "http://192.168.3.7:3000" }));
});
