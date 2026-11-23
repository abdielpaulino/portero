import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createPrivacyReporter } from "../src/nuvemshop/privacy-report.js";

const env = {
  RESEND_API_KEY: "credencial-ficticia-exclusiva-dos-testes",
  PRIVACY_FROM_EMAIL: "portero@example.test",
  PRIVACY_MERCHANT_EMAIL: "lojista@example.test",
  PORTERO_INSTALLATION_ID: "instalacao-offline",
};
const request = { storeId: "67890", requestId: "456" };

describe("relatórios de privacidade com provedor simulado", { concurrency: false }, () => {
  let calls: { url: string; init: RequestInit }[];
  let response: () => Promise<Response>;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return response();
  };
  beforeEach(() => { calls = []; response = async () => Response.json({ id: "envio-ficticio" }); });

  it("envia apenas o relatório de ausência de dados ao lojista configurado", async () => {
    const report = createPrivacyReporter(env, fetcher)!;
    const payload = { ...request, customer: { email: "consumidor@example.test", phone: "+5511999999999" } };
    await report(payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.redirect, "error");
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${env.RESEND_API_KEY}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    const raw = String(calls[0].init.body);
    const body = JSON.parse(raw);
    assert.equal(body.from, env.PRIVACY_FROM_EMAIL);
    assert.deepEqual(body.to, [env.PRIVACY_MERCHANT_EMAIL]);
    assert.match(body.subject, /456/);
    assert.match(body.text, /67890/);
    assert.match(body.text, /não armazena identificação de consumidores/);
    assert.match(body.text, /dados comerciais mínimos.*sem persistência local/);
    assert.ok(!raw.includes(payload.customer.email));
    assert.ok(!raw.includes(payload.customer.phone));
    assert.ok(!raw.includes(env.RESEND_API_KEY));
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  it("mantém a chave de idempotência em reentrega e reinicialização, isolando instalação, loja e pedido", async () => {
    await createPrivacyReporter(env, fetcher)!(request);
    await createPrivacyReporter({ ...env }, fetcher)!(request);
    await createPrivacyReporter({ ...env, PORTERO_INSTALLATION_ID: "outra-instalacao" }, fetcher)!(request);
    await createPrivacyReporter(env, fetcher)!({ ...request, storeId: "999" });
    await createPrivacyReporter(env, fetcher)!({ ...request, requestId: "457" });
    const keys = calls.map(call => new Headers(call.init.headers).get("Idempotency-Key"));
    assert.match(keys[0]!, /^privacy\/[a-f0-9]{64}$/);
    assert.equal(keys[0], keys[1]);
    assert.equal(new Set([keys[0], keys[2], keys[3], keys[4]]).size, 4);
  });

  it("retorna canal ausente somente quando as três configurações de envio estão vazias", () => {
    assert.equal(createPrivacyReporter({}, fetcher), undefined);
    assert.equal(createPrivacyReporter({ PORTERO_INSTALLATION_ID: env.PORTERO_INSTALLATION_ID }, fetcher), undefined);
    assert.deepEqual(calls, []);
  });

  it("recusa configuração parcial, endereço inválido e quebra de linha na credencial antes do envio", () => {
    for (const invalid of [
      { ...env, RESEND_API_KEY: undefined }, { ...env, PRIVACY_FROM_EMAIL: undefined },
      { ...env, PRIVACY_MERCHANT_EMAIL: undefined }, { ...env, PORTERO_INSTALLATION_ID: undefined },
      { ...env, PRIVACY_MERCHANT_EMAIL: "endereco-invalido" },
      { ...env, PRIVACY_FROM_EMAIL: "Remetente <portero@example.test>" },
      { ...env, RESEND_API_KEY: "segredo\r\nOutro: cabecalho" },
    ]) assert.throws(() => createPrivacyReporter(invalid, fetcher), /canal de privacidade completo/);
    assert.deepEqual(calls, []);
  });

  it("recusa IDs inválidos sem enviar conteúdo ao provedor", async () => {
    const report = createPrivacyReporter(env, fetcher)!;
    for (const invalid of [
      { ...request, storeId: "0" }, { ...request, storeId: "1\n2" },
      { ...request, requestId: "-1" }, { ...request, requestId: "1.5" },
      { ...request, requestId: "456\nDestinatario: outro@example.test" },
    ]) await assert.rejects(report(invalid), /Solicitação inválida/);
    assert.deepEqual(calls, []);
  });

  it("falhas HTTP e de rede não informam sucesso nem repetem automaticamente o envio", async () => {
    const report = createPrivacyReporter(env, fetcher)!;
    for (const status of [401, 429, 500]) {
      calls = []; response = async () => new Response(env.RESEND_API_KEY, { status });
      await assert.rejects(report(request), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /não confirmou/);
        assert.ok(!error.message.includes(env.RESEND_API_KEY));
        return true;
      });
      assert.equal(calls.length, 1);
    }
    calls = []; response = async () => { throw new Error(`rede indisponível ${env.RESEND_API_KEY}`); };
    await assert.rejects(report(request), /não confirmou/);
    assert.equal(calls.length, 1);
  });

  it("exige JSON válido e identificador de envio não vazio mesmo depois de HTTP de sucesso", async () => {
    const report = createPrivacyReporter(env, fetcher)!;
    response = async () => new Response("{invalid", { status: 200 });
    await assert.rejects(report(request), /não confirmou/);
    for (const body of [null, [], {}, { id: "" }, { id: "  " }, { id: 123 }]) {
      response = async () => Response.json(body);
      await assert.rejects(report(request), /não confirmou/);
    }
  });

  it("aplica timeout à conexão e à leitura do corpo sem confirmação falsa", async () => {
    let attempts = 0;
    for (const phase of ["fetch", "body"]) {
      const delayed: typeof fetch = async (_url, init) => {
        attempts++;
        const pending = () => new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => resolve({ id: "envio-tardio" }), 500);
          init!.signal!.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("timeout simulado"));
          }, { once: true });
        });
        if (phase === "fetch") { await pending(); return Response.json({ id: "envio-tardio" }); }
        return { ok: true, json: pending } as unknown as Response;
      };
      await assert.rejects(createPrivacyReporter(env, delayed, 10)!(request), /não confirmou/);
    }
    assert.equal(attempts, 2);
  });
});
