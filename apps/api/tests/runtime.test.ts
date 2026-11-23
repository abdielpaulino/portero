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
  assert.equal(runtime.externalSalesEnabled, false);
  assert.equal(runtime.onlineOrdersEnabled, false);
  assert.equal(runtime.invitationsEnabled, false); assert.equal(runtime.settingsEnabled, false); assert.equal(runtime.conferencesEnabled, false); assert.equal(runtime.notificationsEnabled, false);
  assert.equal(readRuntime({ ...local, STOCK_DECREASES_ENABLED: "true" }).stockEnabled, true);
});
it("notificações exigem flag explícita, preferências e segredo do agendamento; módulos não dependem da extensão comercial", () => {
  assert.equal(readRuntime({ ...local, INVITATIONS_ENABLED: "true" }).invitationsEnabled, true);
  assert.equal(readRuntime({ ...local, STORE_SETTINGS_ENABLED: "true" }).externalSalesEnabled, false);
  assert.throws(() => readRuntime({ ...local, STOCK_NOTIFICATIONS_ENABLED: "true" }));
  assert.throws(() => readRuntime({ ...local, STORE_SETTINGS_ENABLED: "true", STOCK_NOTIFICATIONS_ENABLED: "true", CRON_SECRET: "curto" }));
});
it("ativação comercial e leitura de pedidos são independentes e recusam flags inválidas", () => {
  assert.equal(readRuntime({ ...local, EXTERNAL_SALES_ENABLED: "true" }).onlineOrdersEnabled, false);
  assert.equal(readRuntime({ ...local, ONLINE_ORDERS_ENABLED: "true" }).externalSalesEnabled, false);
  assert.throws(() => readRuntime({ ...local, EXTERNAL_SALES_ENABLED: "sim" }));
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
