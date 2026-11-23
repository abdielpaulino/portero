import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { createSessionService, SESSION_COOKIE } from "../src/auth/session.js";
import { createProductsClient, type StoreCredentials } from "../src/nuvemshop/products.js";

const secret = "segredo-dos-testes-de-inventario-com-32-bytes";
const store: StoreCredentials = { id: 10, nuvemshopStoreId: "67890", accessToken: "token-ficticio-de-inventario" };
const variant = { id: 101, values: [{ pt: "9" }, { pt: "Azul" }], sku: "LUVA-9", price: "129.90", stock: 3, stock_management: true };
const product = { id: 100, name: { pt: "Luva Portero" }, images: [], variants: [variant] };

describe("inventário protegido com Nuvemshop e banco simulados", () => {
  const servers: Server[] = [];
  let base: string;
  let unconfiguredBase: string;
  let cookie: string;
  let stores: StoreCredentials[];
  let databaseFailure: boolean;
  let lookedUpUsers: number[];
  let calls: { url: URL; init: RequestInit }[];
  let respond: (init: RequestInit) => Promise<Response>;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init: init! });
    return respond(init!);
  };

  async function start(configured: boolean) {
    const server = createApp({ jwtSecret: secret,
      repository: { async buscarUsuariosPorEmail() { return []; }, async listarLojas() { return []; } },
      inventory: configured ? { client: createProductsClient("PORTERO (dev@example.test)", fetcher, 50),
        repository: { async listarLojas(userId) {
          lookedUpUsers.push(userId);
          if (databaseFailure) throw new Error(store.accessToken);
          return stores;
        } } } : undefined,
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
    cookie = `${SESSION_COOKIE}=${await createSessionService(secret).issue({ usuarioId: 1, lojaId: store.id })}`;
  });
  beforeEach(() => {
    stores = [{ ...store }]; calls = []; lookedUpUsers = []; databaseFailure = false;
    respond = async () => Response.json([product]);
  });
  after(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    })));
  });
  async function request(query = "", authCookie: string | undefined = cookie, target = base) {
    const response = await fetch(`${target}/inventory${query}`, { headers: authCookie ? { Cookie: authCookie } : {} });
    const text = await response.text();
    assert.ok(!text.includes(store.accessToken));
    assert.ok(!JSON.stringify([...response.headers]).includes(store.accessToken));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, body: JSON.parse(text) };
  }

  it("exige sessão válida antes de consultar banco ou Nuvemshop", async () => {
    for (const authCookie of ["", `${SESSION_COOKIE}=invalido`]) {
      assert.equal((await request("", authCookie)).status, 401);
    }
    assert.equal(calls.length, 0); assert.deepEqual(lookedUpUsers, []);
  });
  it("revalida a associação única e a loja da sessão", async () => {
    for (const associations of [[], [{ ...store, id: 20 }], [store, { ...store, id: 20 }]]) {
      stores = associations;
      assert.equal((await request()).status, 403);
    }
    assert.equal(calls.length, 0);
  });
  it("usa somente as credenciais do servidor e retorna uma linha por variante", async () => {
    respond = async () => Response.json([{ ...product, images: [{ id: 8, src: "https://example.test/luva.jpg" }],
      variants: [variant, { ...variant, id: 102, values: [], sku: null, price: null, stock: null, stock_management: false }] }]);
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual(lookedUpUsers, [1]);
    assert.deepEqual(result.body, { page: 1, nextPage: null, items: [
      { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva Portero", variante: "9 / Azul",
        sku: "LUVA-9", preco: 129.9, quantidade: 3, ruptura: false, imagemUrl: "https://example.test/luva.jpg" },
      { id: "100:102", produtoId: "100", varianteId: "102", nome: "Luva Portero", variante: "Única",
        sku: null, preco: null, quantidade: null, ruptura: false, imagemUrl: "https://example.test/luva.jpg" },
    ] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, `/2025-03/${store.nuvemshopStoreId}/products`);
    assert.equal(calls[0].url.searchParams.get("per_page"), "100");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.redirect, "error");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${store.accessToken}`);
    assert.equal(headers.get("User-Agent"), "PORTERO (dev@example.test)");
  });
  it("recusa IDs, tokens e páginas arbitrárias na query", async () => {
    for (const query of ["?lojaId=20", "?access_token=falso", "?page=0", "?page=-1", "?page=1.5", "?page=1&page=2", "?page=1000000"]) {
      assert.equal((await request(query)).status, 400);
    }
    assert.equal(calls.length, 0); assert.deepEqual(lookedUpUsers, []);
  });
  it("pagina por Link sem seguir destinos remotos e termina na última página", async () => {
    respond = async () => Response.json([product], { headers: {
      Link: `<https://api.nuvemshop.com.br/2025-03/${store.nuvemshopStoreId}/products?page=2&per_page=100>; rel="next"`,
    } });
    assert.equal((await request()).body.nextPage, 2);
    assert.equal(calls.length, 1);
    respond = async () => Response.json([]);
    assert.deepEqual((await request("?page=2")).body, { items: [], page: 2, nextPage: null });
    assert.equal(calls[1].url.searchParams.get("page"), "2");
    respond = async () => Response.json([product], { headers: { Link: '<https://evil.example/products?page=2>; rel="next"' } });
    assert.equal((await request()).status, 502);
    assert.ok(calls.every((call) => call.url.hostname === "api.nuvemshop.com.br"));
  });
  it("usa x-total-count e tamanho da página quando Link não estiver disponível", async () => {
    respond = async () => Response.json([product], { headers: { "x-total-count": "101" } });
    assert.equal((await request()).body.nextPage, 2);
    assert.equal((await request("?page=2")).body.nextPage, null);
    respond = async () => Response.json(Array.from({ length: 100 }, (_, i) => ({ ...product, id: i + 1 })));
    assert.equal((await request()).body.nextPage, 2);
  });
  it("lê inventory_levels, alerta estoque zero e usa idioma e imagem da variante", async () => {
    respond = async () => Response.json([{ ...product, name: { es: "Guante" },
      images: [{ id: 1, src: "https://example.test/padrao.jpg" }, { id: 2, src: "//example.test/variante.jpg" }],
      variants: [{ ...variant, image_id: 2, values: [{ es: "Rojo" }], stock: 99, inventory_levels: [{ stock: 0 }] }] }],
    { headers: { "x-main-language": "es" } });
    const item = (await request()).body.items[0];
    assert.equal(item.quantidade, 0); assert.equal(item.ruptura, true);
    assert.equal(item.nome, "Guante"); assert.equal(item.variante, "Rojo");
    assert.equal(item.imagemUrl, "https://example.test/variante.jpg");
  });
  it("recusa respostas inconsistentes sem devolver inventário parcial", async () => {
    for (const payload of [null, {}, [{ ...product, variants: null }],
      [{ ...product, variants: [{ ...variant, stock: "3" }] }],
      [{ ...product, variants: [{ ...variant, price: "invalido" }] }]]) {
      respond = async () => Response.json(payload);
      assert.equal((await request()).status, 502);
    }
  });
  it("trata erros de acesso, limite e indisponibilidade sem repassar corpos externos", async () => {
    for (const status of [401, 403, 429, 500, 200]) {
      respond = async () => new Response(store.accessToken, { status });
      assert.equal((await request()).status, status === 429 ? 503 : 502);
    }
    respond = async () => { throw new Error(store.accessToken); };
    assert.equal((await request()).status, 502);
  });
  it("aplica timeout inclusive à leitura do corpo", async () => {
    respond = async (init) => {
      const body = new Promise<never>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
      return { ok: true, status: 200, headers: new Headers(), json: () => body } as Response;
    };
    assert.equal((await request()).status, 504);
  });
  it("trata configuração ausente, credencial inválida e falha do banco sem expor o token", async () => {
    assert.equal((await request("", cookie, unconfiguredBase)).status, 503);
    stores = [{ ...store, accessToken: "" }];
    const invalidCredentials = await request();
    assert.equal(invalidCredentials.status, 409);
    assert.match(invalidCredentials.body.message, /conferência administrativa/);
    assert.doesNotMatch(invalidCredentials.body.message, /refaça.*OAuth/i);
    databaseFailure = true;
    assert.equal((await request()).status, 500);
    assert.equal(calls.length, 0);
  });
  it("não expõe uma rota de alteração de estoque", async () => {
    const response = await fetch(`${base}/inventory/101/stock`, { method: "PATCH", headers: { Cookie: cookie } });
    assert.equal(response.status, 404); assert.equal(calls.length, 0);
  });

  it("consulta detalhes e variantes por ID somente na loja da sessão, sem expor credenciais", async () => {
    respond = async () => Response.json({ ...product, images: [{ id: 8, src: "https://example.test/luva.jpg" }],
      variants: [variant, { ...variant, id: 102, values: [{ pt: "10" }], sku: null, stock: -1 }] });
    const result = await request("/products/100");
    assert.equal(result.status, 200); assert.equal(result.body.produtoId, "100");
    assert.equal(result.body.nome, "Luva Portero"); assert.equal(result.body.items.length, 2);
    assert.equal(result.body.items[1].quantidade, -1); assert.equal(result.body.items[1].ruptura, true);
    assert.deepEqual(lookedUpUsers, [1]);
    assert.equal(calls[0].url.pathname, "/2025-03/67890/products/100");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), `Bearer ${store.accessToken}`);
  });

  it("detalhes exigem sessão e vínculo e recusam parâmetros de credenciais ou loja", async () => {
    assert.equal((await request("/products/100", "")).status, 401);
    stores = []; assert.equal((await request("/products/100")).status, 403);
    stores = [store];
    for (const path of ["/products/0", "/products/100?lojaId=20", "/products/100?token=outra-credencial"])
      assert.equal((await request(path)).status, 400);
    assert.equal((await request("/products/100", cookie, unconfiguredBase)).status, 503);
    assert.equal(calls.length, 0);
  });

  it("detalhes tratam produto removido, resposta de outro produto e falha remota sem sucesso falso", async () => {
    respond = async () => new Response(store.accessToken, { status: 404 });
    assert.equal((await request("/products/100")).status, 404);
    respond = async () => Response.json({ ...product, id: 200 });
    assert.equal((await request("/products/100")).status, 502);
    respond = async () => new Response("conteudo-invalido");
    assert.equal((await request("/products/100")).status, 502);
    respond = async () => new Response(store.accessToken, { status: 429 });
    assert.equal((await request("/products/100")).status, 503);
  });

  it("detalhes limitam também a leitura do corpo e nunca enviam uma escrita", async () => {
    respond = async init => ({ ok: true, status: 200, headers: new Headers(), json: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }) }) as Response;
    assert.equal((await request("/products/100")).status, 504);
    assert.ok(calls.every(call => call.init.method === "GET"));
  });
});
