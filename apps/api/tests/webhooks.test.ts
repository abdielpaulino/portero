import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import { createNuvemshopWebhookRouter } from "../src/nuvemshop/webhooks.js";

const clientSecret = "segredo-ficticio-dos-webhooks-offline";
const storeId = "67890", clientId = "12345";
type Event = "app/uninstalled" | "app/suspended" | "app/store_redact";
type ReportRequest = { storeId: string; requestId: string };
const customer = { id: 17, email: "consumidor@example.test", phone: "+5511999999999", identification: "identificacao-ficticia" };
const operational = (event: Event = "app/uninstalled") => ({ store_id: Number(storeId), event, id: Number(clientId), event_launch_ts: 1_800_000_000 });
const dataRequest = () => ({ store_id: Number(storeId), customer, orders_requested: [], checkouts_requested: [],
  drafts_orders_requested: [], data_request: { id: 456 } });

describe("webhooks Nuvemshop com persistência e entrega simuladas", { concurrency: false }, () => {
  const servers: Server[] = [];
  let base: string;
  let received: { storeId: string; event: Event }[];
  let reports: ReportRequest[];
  let failure: boolean;
  let reportFailure: boolean;

  const repository = {
    async handle(id: string, event: Event) {
      if (failure) throw new Error(`falha interna ${clientSecret} ${customer.email}`);
      received.push({ storeId: id, event });
    },
  };
  const reporter = async (request: ReportRequest) => {
    if (reportFailure) throw new Error(`falha de entrega ${clientSecret} ${customer.email}`);
    reports.push(request);
  };

  async function start(options: { storeId?: string; clientSecret?: string; clientId?: string;
    reporter?: ((request: ReportRequest) => Promise<void>) | null } = {}) {
    const app = express();
    app.use("/webhooks/nuvemshop", createNuvemshopWebhookRouter({
      clientSecret: options.clientSecret ?? clientSecret,
      storeId: options.storeId ?? storeId,
      clientId: options.clientId ?? clientId,
      repository,
      reporter: options.reporter === null ? undefined : options.reporter ?? reporter,
    }));
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(error.status === 413 ? 413 : 400).json({ message: "Requisição inválida." });
    };
    app.use(errors);
    const server = app.listen(0, "127.0.0.1");
    servers.push(server); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }

  before(async () => { base = await start(); });
  beforeEach(() => { received = []; reports = []; failure = false; reportFailure = false; });
  after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  async function post(path: string, payload: unknown, options: { target?: string; signature?: string | null; raw?: string } = {}) {
    const raw = options.raw ?? JSON.stringify(payload);
    const signature = options.signature === undefined ? createHmac("sha256", clientSecret).update(raw).digest("hex") : options.signature;
    return fetch(`${options.target ?? base}/webhooks/nuvemshop${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(signature === null ? {} : { "x-linkedstore-hmac-sha256": signature }) }, body: raw,
    });
  }

  it("valida o corpo bruto com espaços antes de processar, sem exigir cookie ou Origin", async () => {
    const raw = ` {\n "store_id": ${storeId},\n "event": "app/uninstalled", "id": ${clientId}\n}\n`;
    const response = await post("/uninstalled", undefined, { raw });
    assert.equal(response.status, 204);
    assert.deepEqual(received, [{ storeId, event: "app/uninstalled" }]);
    assert.equal(await response.text(), "");
    assert.deepEqual(reports, []);
  });

  it("recusa assinatura ausente, incorreta, não hexadecimal e calculada com outra chave", async () => {
    const payload = operational();
    const otherSecret = createHmac("sha256", "outra-chave-ficticia").update(JSON.stringify(payload)).digest("hex");
    for (const signature of [null, "", "a".repeat(63), "g".repeat(64), "0".repeat(64), otherSecret]) {
      assert.equal((await post("/uninstalled", payload, { signature })).status, 401);
    }
    assert.deepEqual(received, []);
  });

  it("recusa alteração no corpo depois de assiná-lo, mesmo quando o JSON representa os mesmos dados", async () => {
    const payload = operational();
    const signature = createHmac("sha256", clientSecret).update(JSON.stringify(payload)).digest("hex");
    assert.equal((await post("/uninstalled", payload, { signature, raw: JSON.stringify(payload, null, 2) })).status, 401);
    assert.deepEqual(received, []);
  });

  it("rejeita assinatura antes de interpretar um JSON inválido", async () => {
    assert.equal((await post("/uninstalled", undefined, { raw: "{invalid", signature: "0".repeat(64) })).status, 401);
    assert.deepEqual(received, []);
  });

  it("recusa JSON inválido ou payload sem identificadores válidos antes da persistência", async () => {
    assert.equal((await post("/uninstalled", undefined, { raw: "{invalid" })).status, 400);
    for (const payload of [null, [], {}, { ...operational(), store_id: null }, { ...operational(), store_id: 0 },
      { ...operational(), id: undefined }, { ...operational(), event: "app/suspended" }]) {
      assert.equal((await post("/uninstalled", payload)).status, 400);
    }
    assert.deepEqual(received, []);
  });

  it("recusa o ID de outra loja e de outro aplicativo sem alterar a instalação", async () => {
    assert.equal((await post("/uninstalled", { ...operational(), store_id: 999 })).status, 403);
    const appMismatch = await post("/uninstalled", { ...operational(), id: 999 });
    assert.ok([400, 403].includes(appMismatch.status));
    assert.deepEqual(received, []);
  });

  it("bloqueia o recebimento quando a loja ainda não foi configurada", async () => {
    const target = await start({ storeId: "" });
    assert.equal((await post("/uninstalled", operational(), { target })).status, 503);
    assert.deepEqual(received, []);
  });

  it("encaminha suspensão sem timestamp e exclusão da loja sem event aos estados persistentes", async () => {
    const suspended = { store_id: storeId, event: "app/suspended", id: clientId };
    assert.equal((await post("/suspended", suspended)).status, 204);
    assert.equal((await post("/store-redact", { store_id: storeId })).status, 204);
    assert.deepEqual(received, [{ storeId, event: "app/suspended" }, { storeId, event: "app/store_redact" }]);
  });

  it("não usa a assinatura de outro evento como autorização para excluir a loja", async () => {
    for (const payload of [operational(), { store_id: storeId, customer, orders_to_redact: [] }, dataRequest()]) {
      assert.equal((await post("/store-redact", payload)).status, 400);
    }
    assert.deepEqual(received, []);
    assert.deepEqual(reports, []);
  });

  it("mantém reentregas sob responsabilidade do repositório entre duas instâncias", async () => {
    const second = await start();
    assert.equal((await post("/uninstalled", operational())).status, 204);
    assert.equal((await post("/uninstalled", operational(), { target: second })).status, 204);
    assert.deepEqual(received, [{ storeId, event: "app/uninstalled" }, { storeId, event: "app/uninstalled" }]);
  });

  it("não confirma persistência que falhou e permite nova entrega sem expor os detalhes", async () => {
    failure = true;
    const response = await post("/store-redact", { store_id: storeId });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes(clientSecret)); assert.ok(!body.includes(customer.email));
    assert.deepEqual(received, []);
    failure = false;
    assert.equal((await post("/store-redact", { store_id: storeId })).status, 204);
    assert.deepEqual(received, [{ storeId, event: "app/store_redact" }]);
  });

  it("trata exclusão de consumidor sem excluir operadores nem persistir seus dados pessoais", async () => {
    const response = await post("/customer-redact", { store_id: storeId, customer, orders_to_redact: [12, 34] });
    assert.equal(response.status, 204);
    assert.deepEqual(received, []);
    assert.deepEqual(reports, []);
    assert.equal(await response.text(), "");
    for (const payload of [{ store_id: storeId }, { store_id: storeId, customer: {} }]) {
      assert.equal((await post("/customer-redact", payload)).status, 400);
    }
  });

  it("envia relatório de ausência de dados com apenas IDs da loja e da solicitação", async () => {
    const response = await post("/customer-data-request", dataRequest());
    assert.equal(response.status, 204);
    assert.deepEqual(reports, [{ storeId, requestId: "456" }]);
    assert.deepEqual(received, []);
    assert.equal(await response.text(), "");
  });

  it("não entrega relatórios nem aceita exclusão de consumidor de outra loja", async () => {
    assert.equal((await post("/customer-data-request", { ...dataRequest(), store_id: "999" })).status, 403);
    assert.equal((await post("/customer-redact", { store_id: "999", customer })).status, 403);
    assert.deepEqual(reports, []);
    assert.deepEqual(received, []);
  });

  it("valida consumidor e solicitação antes de tentar entregar um relatório", async () => {
    for (const payload of [{ store_id: storeId, data_request: { id: 456 } }, { ...dataRequest(), customer: {} },
      { ...dataRequest(), data_request: undefined }, { ...dataRequest(), data_request: { id: 0 } }]) {
      assert.equal((await post("/customer-data-request", payload)).status, 400);
    }
    assert.deepEqual(reports, []);
  });

  it("não confirma o pedido de dados quando o canal está ausente ou falha", async () => {
    const target = await start({ reporter: null });
    assert.equal((await post("/customer-data-request", dataRequest(), { target })).status, 503);
    reportFailure = true;
    const failed = await post("/customer-data-request", dataRequest());
    assert.equal(failed.status, 503);
    const body = await failed.text();
    assert.ok(!body.includes(clientSecret)); assert.ok(!body.includes(customer.email));
    assert.deepEqual(reports, []);
    reportFailure = false;
    assert.equal((await post("/customer-data-request", dataRequest())).status, 204);
    assert.deepEqual(reports, [{ storeId, requestId: "456" }]);
  });

  it("aguarda a entrega do relatório antes de confirmar o webhook", async () => {
    let release!: () => void, began!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { began = resolve; });
    const target = await start({ reporter: async () => { began(); await gate; } });
    let responded = false;
    const pending = post("/customer-data-request", dataRequest(), { target }).then(response => { responded = true; return response; });
    await started;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(responded, false);
    release();
    assert.equal((await pending).status, 204);
  });

  it("recusa corpos acima de 256 KiB sem processar a solicitação", async () => {
    const raw = JSON.stringify({ ...operational(), padding: "x".repeat(256 * 1024) });
    assert.equal((await post("/uninstalled", undefined, { raw })).status, 413);
    assert.deepEqual(received, []);
    assert.deepEqual(reports, []);
  });
});
