import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { createSessionService, SESSION_COOKIE } from "../src/auth/session.js";
import { NuvemshopError } from "../src/nuvemshop/oauth.js";
import { createStockClient } from "../src/nuvemshop/stock.js";
import type { StockRecord, StockRepository } from "../src/stock/service.js";

const secret = "segredo-local-das-baixas-com-mais-de-32-bytes";
const command = { produtoId: "100", varianteId: "101", quantidade: 2 };
const variant = { id: 101, product_id: 100, sku: "LUVA-9", stock: 8, stock_management: true };
describe("baixa em duas etapas com banco e Nuvemshop simulados", () => {
  const servers: Server[] = [];
  let base: string, second: string, production: string, cookie: string, otherCookie: string;
  let records: StockRecord[], locked: boolean, access: boolean, demoId: string;
  let failure: string | undefined;
  let calls: { url: string; init: RequestInit }[];
  let respond: typeof fetch;
  // Simula armazenamento compartilhado. A implementação de produção usa SQL e advisory lock.
  function database(): StockRepository {
    return { async withLock(auth, target, work) {
      if (!access) throw new NuvemshopError(403, "Vínculo revogado.");
      const record = typeof target === "number" ? records.find(row => row.id === target && row.usuarioId === auth.usuarioId && auth.lojaId === 10) : undefined;
      if (typeof target === "number" && !record) throw new NuvemshopError(404, "Operação indisponível.");
      if (locked) throw new NuvemshopError(409, "Variante ocupada.");
      locked = true;
      const variantId = record?.variantId ?? (target as typeof command).varianteId;
      try { return await work({ store: { id: 10, nuvemshopStoreId: demoId, accessToken: "token-ficticio" }, operation: record && { ...record },
        async hasUnresolved(exceptId = 0) { return records.some(row => row.variantId === variantId && row.id !== exceptId && !["sincronizada", "rejeitada"].includes(row.statusSincronizacao)); },
        async create(data) {
          const inserted = { id: records.length + 1, usuarioId: auth.usuarioId, produtoId: data.produtoId,
            variantId: data.varianteId, quantidadeBaixada: data.quantidade, statusSincronizacao: "registrada" };
          records.push(inserted);
          if (failure === "create-response") throw new NuvemshopError(503, "Resposta local perdida.");
          return { ...inserted };
        },
        async prepare(id) {
          if (failure === "prepare") throw new NuvemshopError(503, "Preparação recusada.");
          records.find(row => row.id === id)!.statusSincronizacao = "em_processamento";
          if (failure === "prepare-response") throw new NuvemshopError(503, "Confirmação da preparação perdida.");
        },
        async status(id, status) {
          if (failure === status || failure === "all-status") throw new NuvemshopError(503, "Falha local.");
          records.find(row => row.id === id)!.statusSincronizacao = status;
        },
      }); } finally { locked = false; }
    } };
  }
  async function start(environment = "development", timeout = 100) {
    const client = createStockClient("PORTERO (dev@example.test)", async (url, init) => {
      calls.push({ url: String(url), init: init! }); return respond(url, init);
    }, timeout);
    const server = createApp({ jwtSecret: secret, environment,
      repository: { async buscarUsuariosPorEmail() { return []; }, async listarLojas() { return []; } },
      stock: { demoStoreId: "67890", repository: database(), client } }).listen(0, "127.0.0.1");
    servers.push(server); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }
  before(async () => {
    base = await start(); second = await start(); production = await start("production");
    cookie = `${SESSION_COOKIE}=${await createSessionService(secret).issue({usuarioId:1,lojaId:10})}`;
    otherCookie = `${SESSION_COOKIE}=${await createSessionService(secret).issue({usuarioId:2,lojaId:10})}`;
  });
  beforeEach(() => {
    records = []; locked = false; access = true; demoId = "67890"; failure = undefined; calls = [];
    respond = async (_url, init) => Response.json(init?.method === "POST" ? [{ ...variant, stock: 6 }] : variant);
  });
  after(async () => { for (const server of servers) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  async function request(path = "", body: unknown = command, auth = cookie, target = base, method = "POST", headers = {}) {
    const response = await fetch(`${target}/inventory/stock-decreases${path}`, { method,
      headers: { ...(auth ? { Cookie: auth } : {}), ...(method === "GET" ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); assert.ok(!text.includes("token-ficticio"));
    return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : null };
  }
  async function reserve(data = command) { const result = await request("", data); assert.equal(result.status, 201); return result.body.baixaId as number; }
  const execute = (id: number, target = base) => request(`/${id}/execute`, {}, cookie, target);

  it("cria somente registro local e executa depois pelo ID original, sem alterar seus dados", async () => {
    const id = await reserve(); assert.equal(calls.length, 0); assert.equal(records[0].statusSincronizacao, "registrada");
    const result = await execute(id); assert.equal(result.status, 200); assert.equal(result.body.statusSincronizacao, "sincronizada");
    assert.deepEqual(result.body.quantidade, 2); assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].init.body as string), { action: "variation", value: -2, id: 101 });
    assert.ok(!("estoqueNovo" in result.body)); assert.ok(!("requisicaoId" in result.body));
  });
  it("exige sessão, vínculo, autor, loja demo e development", async () => {
    assert.equal((await request("", command, "")).status, 401);
    assert.equal((await request("", command, cookie, production)).status, 404);
    demoId = "999"; assert.equal((await request()).status, 403); demoId = "67890";
    const id = await reserve();
    assert.equal((await request(`/${id}/execute`, {}, otherCookie)).status, 404);
    const wrongStoreCookie = `${SESSION_COOKIE}=${await createSessionService(secret).issue({usuarioId:1,lojaId:20})}`;
    assert.equal((await request(`/${id}/execute`, {}, wrongStoreCookie)).status, 404);
    access = false; assert.equal((await execute(id)).status, 403); assert.equal(calls.length, 0);
  });
  it("recusa dados substituídos, queries, IDs e contrato UUID antigo", async () => {
    for (const bad of [{ ...command, quantidade:0 },{ ...command, quantidade:1.2 },{ ...command, lojaId:10 },{ ...command, varianteId:"9007199254740992" }]) assert.equal((await request("",bad)).status,400);
    assert.equal((await request("",command,cookie,base,"POST",{"Idempotency-Key":"antiga"})).status,400);
    const id = await reserve();
    for (const body of [command, {quantidade:1}, {usuarioId:1}, [], null]) assert.equal((await request(`/${id}/execute`,body)).status,400);
    for (const path of ["/0/execute","/2147483648/execute",`/${id}/execute?quantidade=1`]) assert.equal((await request(path,{})).status,400);
    assert.equal(calls.length,0); assert.equal(records[0].quantidadeBaixada,2);
  });
  it("reenvio e nova instância consultam a mesma conclusão sem outro desconto", async () => {
    const id = await reserve(); await execute(id);
    assert.equal((await execute(id,second)).body.repetida,true);
    assert.equal((await request(`/${id}`,{},cookie,second,"GET")).body.statusSincronizacao,"sincronizada");
    assert.equal(calls.length,2); assert.equal(records.length,1);
  });
  it("criação cuja resposta se perdeu não provoca execução nem criação automática por semelhança", async () => {
    failure = "create-response"; assert.equal((await request()).status,503);
    failure = undefined; assert.equal(records.length,1); assert.equal(calls.length,0);
    assert.equal((await request("", {...command,quantidade:3})).status,409);
    assert.equal((await request()).status,409); assert.equal(records.length,1);
    const recovered = await request("/1",{},cookie,second,"GET"); assert.equal(recovered.body.baixaId,1);
    assert.equal(calls.length,0); assert.equal((await execute(1)).body.statusSincronizacao,"sincronizada");
  });
  it("duas instâncias não criam ou executam simultaneamente na mesma variante", async () => {
    const results = await Promise.all([request(),request("",command,cookie,second)]);
    assert.deepEqual(results.map(row => row.status).sort(),[201,409]); assert.equal(records.length,1);
    let release!: () => void; const gate = new Promise<void>(resolve => {release=resolve;});
    let entered!: () => void; const ready = new Promise<void>(resolve => {entered=resolve;});
    respond = async (_url,init) => { if (init?.method === "GET") { entered(); await gate; return Response.json(variant); } return Response.json([{...variant,stock:6}]); };
    const first = execute(1); await ready;
    assert.equal((await execute(1,second)).status,409); release(); assert.equal((await first).status,200); assert.equal(calls.length,2);
  });
  it("falha ou perda da confirmação da preparação impede o envio remoto", async () => {
    const id = await reserve();
    for (const point of ["prepare","prepare-response"]) {
      records[0].statusSincronizacao="registrada"; calls=[]; failure=point;
      assert.equal((await execute(id)).status,503); assert.ok(calls.every(call=>call.init.method==="GET"));
    }
    failure=undefined; const count=calls.length; assert.equal((await execute(id,second)).status,409); assert.equal(calls.length,count);
  });
  it("venda externa entre GET e POST não é sobrescrita e divergência fica incerta", async () => {
    let stock=8;
    respond=async (_url,init)=> { if(init?.method==="GET") return Response.json({...variant,stock}); stock-=1; stock+=JSON.parse(init!.body as string).value; return Response.json([{...variant,stock}]); };
    const id=await reserve(); assert.equal((await execute(id)).body.statusSincronizacao,"incerta"); assert.equal(stock,5);
    assert.equal((await execute(id,second)).status,409); assert.equal((await request()).status,409); assert.equal(calls.length,2);
  });
  it("saldo zero sempre exige conferência, inclusive com concorrência que limita a redução", async () => {
    for (const concurrent of [0,3]) {
      records=[]; calls=[];
      respond=async (_url,init)=>Response.json(init?.method==="GET"?{...variant,stock:5}:[{...variant,stock:Math.max(0,5-concurrent-5)}]);
      const id=await reserve({...command,quantidade:5}); const result=await execute(id);
      assert.equal(result.body.statusSincronizacao,"incerta"); assert.equal(result.status,409);
      assert.equal((await execute(id,second)).status,409); assert.equal(calls.length,2);
    }
  });
  it("falha após atualização remota bloqueia reenvio após reinício e outra criação", async () => {
    for (const point of ["sincronizada","all-status"]) {
      records=[];calls=[];failure=point;
      if(point==="all-status") respond=async(_url,init)=> { if(init?.method==="GET") return Response.json(variant); throw new Error("resposta perdida depois da atualização"); };
      const id=await reserve(); assert.ok((await execute(id)).status>=500);
      assert.equal(records[0].statusSincronizacao,"em_processamento"); failure=undefined;
      const restarted=await start();
      assert.equal((await execute(id,restarted)).status,409); assert.equal((await request()).status,409); assert.equal(calls.length,2);
    }
  });
  it("timeout remoto nunca provoca compensação ou repetição automática", async () => {
    respond=async(_url,init)=>init?.method==="GET"?Response.json(variant):await new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true}));
    const id=await reserve(); assert.equal((await execute(id)).body.statusSincronizacao,"incerta");
    assert.equal((await execute(id)).status,409); assert.equal(calls.length,2);
  });
  it("recusa saldo insuficiente, estoque sem controle e múltiplos locais antes do envio", async () => {
    for(const payload of [{...variant,stock:1},{...variant,stock_management:false},{...variant,inventory_levels:[{stock:4},{stock:4}]}]) {
      records=[];calls=[];respond=async()=>Response.json(payload); const id=await reserve();
      assert.equal((await execute(id)).body.statusSincronizacao,"rejeitada"); assert.ok(calls.every(call=>call.init.method==="GET"));
    }
  });
  it("cancela apenas pendentes, mantém o registro e nunca altera o remoto", async () => {
    const id=await reserve(); assert.equal((await request(`/${id}/cancel`,{})).body.statusSincronizacao,"rejeitada");
    assert.equal((await execute(id)).status,409); assert.equal(calls.length,0); assert.equal(records.length,1);
    records[0].statusSincronizacao="incerta"; assert.equal((await request(`/${id}/cancel`,{})).status,409);
  });
  it("pendentes legadas e registros inconsistentes nunca são executados nem cancelados pelo fluxo novo", async () => {
    const id=await reserve(); records[0].statusSincronizacao="pendente";
    assert.equal((await execute(id)).status,409); assert.equal((await request(`/${id}/cancel`,{})).status,409);
    assert.equal((await request()).status,409); assert.equal(calls.length,0);
    records[0].statusSincronizacao="registrada"; records[0].produtoId="../outro";
    assert.equal((await execute(id)).status,409); assert.equal(calls.length,0);
  });
});
