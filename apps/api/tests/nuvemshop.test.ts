import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { decodeJwt, SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { SESSION_COOKIE } from "../src/auth/session.js";
import { createNuvemshopClient, readNuvemshopConfig, type LojaConectada } from "../src/nuvemshop/oauth.js";
import { OAUTH_COOKIE, OAUTH_SECONDS } from "../src/nuvemshop/routes.js";

const secret = "segredo-apenas-dos-testes-offline-com-32-bytes";
const config = { clientId: "12345", clientSecret: "segredo-ficticio-nao-expor",
  demoStoreId: "67890", userAgent: "PORTERO (dev@example.test)" };
const token = { access_token: "token-ficticio-nao-expor", token_type: "bearer",
  scope: "read_products,write_products,read_locations", user_id: config.demoStoreId };
const store = { id: Number(config.demoStoreId), main_language: "pt", name: { pt: "Loja demo", es: "Tienda demo" } };
const code = "code-ficticio-nao-expor";

describe("OAuth Nuvemshop sem banco e com API externa simulada", { concurrency: false }, () => {
  const servers: Server[] = [];
  let base: string;
  let secondBase: string;
  let setupBase: string;
  let setupSecondBase: string;
  let disabledBases: string[];
  let requests: { url: string; init: RequestInit }[];
  let saved: LojaConectada[];
  let databaseFailure: boolean;
  let respond: (index: number, init: RequestInit) => Promise<Response>;

  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init! });
    return respond(requests.length - 1, init!);
  };

  async function startServer(environment: string, enabled = true, demoStoreId = config.demoStoreId) {
    const serverConfig = { ...config, demoStoreId };
    const server = createApp({
      jwtSecret: secret, environment,
      repository: {
        async buscarUsuariosPorEmail() { throw new Error("OAuth não deve consultar usuários"); },
        async listarLojas() { throw new Error("OAuth não deve consultar associações"); },
      },
      nuvemshop: enabled ? {
        config: serverConfig, client: createNuvemshopClient(serverConfig, fetcher, 50),
        repository: { async salvarLoja(loja) {
          if (databaseFailure) throw new Error(`${token.access_token} ${config.clientSecret} ${code}`);
          saved.push(loja);
        } },
      } : undefined,
    }).listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }

  before(async () => {
    base = await startServer("development");
    secondBase = await startServer("development");
    setupBase = await startServer("development", true, "");
    setupSecondBase = await startServer("development", true, "");
    disabledBases = [await startServer("production"), await startServer("test"), await startServer("development", false)];
  });

  beforeEach(() => {
    requests = [];
    saved = [];
    databaseFailure = false;
    respond = async (index) => Response.json(index === 0 ? token : store);
  });

  after(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
  });

  async function request(path: string, cookie?: string, target = base) {
    const response = await fetch(`${target}/auth/nuvemshop${path}`, {
      redirect: "manual", headers: cookie ? { Cookie: cookie } : {},
    });
    const text = await response.text();
    for (const sensitive of [token.access_token, config.clientSecret, code]) {
      assert.ok(!text.includes(sensitive), "Resposta não deve expor segredos ou code");
      assert.ok(!JSON.stringify([...response.headers]).includes(sensitive), "Headers não devem expor segredos ou code");
    }
    assert.ok(response.headers.getSetCookie().every((value) => value.startsWith(`${OAUTH_COOKIE}=`)),
      "OAuth não pode alterar cookies do login interno");
    return { status: response.status, headers: response.headers, text };
  }

  async function startFlow(target = base, path = "/authorize") {
    const result = await request(path, undefined, target);
    assert.equal(result.status, 302);
    const location = new URL(result.headers.get("Location")!);
    const setCookie = result.headers.getSetCookie()[0];
    const cookie = setCookie.split(";")[0];
    return { result, location, setCookie, cookie, state: location.searchParams.get("state")! };
  }

  async function callback(flow: Awaited<ReturnType<typeof startFlow>>, target = base) {
    return request(`/callback?${new URLSearchParams({ state: flow.state, code })}`, flow.cookie, target);
  }

  it("emite state aleatório e cookie assinado com validade de cinco minutos", async () => {
    const first = await startFlow();
    const second = await startFlow();
    assert.equal(first.location.origin, "https://www.nuvemshop.com.br");
    assert.equal(first.location.pathname, `/apps/${config.clientId}/authorize`);
    assert.match(first.state, /^[a-f0-9]{64}$/);
    assert.notEqual(first.state, second.state);
    assert.match(first.setCookie, /HttpOnly/);
    assert.match(first.setCookie, /SameSite=Lax/);
    assert.match(first.setCookie, /Path=\/auth\/nuvemshop/);
    assert.match(first.setCookie, /Max-Age=300/);
    const claims = decodeJwt(decodeURIComponent(first.cookie.split("=")[1]));
    assert.equal(claims.exp! - claims.iat!, OAUTH_SECONDS);
    assert.equal(claims.sub, first.state);
    assert.equal(first.result.headers.get("Cache-Control"), "no-store");
    assert.equal(first.result.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(requests.length, 0);
  });

  it("aceita callback em outra instância, troca code no backend e salva apenas a loja demo", async () => {
    const flow = await startFlow();
    const result = await callback(flow, secondBase);
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.text).loja, { nuvemshopStoreId: config.demoStoreId, nomeLoja: "Loja demo" });
    assert.deepEqual(saved, [{ nuvemshopStoreId: config.demoStoreId, accessToken: token.access_token,
      scope: token.scope, nomeLoja: "Loja demo" }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://www.nuvemshop.com.br/apps/authorize/token");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body as string), {
      client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code,
    });
    assert.equal(requests[1].url, `https://api.nuvemshop.com.br/2025-03/${config.demoStoreId}/store`);
    assert.equal(new Headers(requests[1].init.headers).get("Authorization"), `Bearer ${token.access_token}`);
    for (const remote of requests) {
      assert.equal(new Headers(remote.init.headers).get("User-Agent"), config.userAgent);
      assert.ok(remote.init.signal instanceof AbortSignal);
      assert.equal(remote.init.redirect, "error");
    }
    assert.match(result.headers.getSetCookie()[0], new RegExp(`^${OAUTH_COOKIE}=;`));
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    const repeat = await request(`/callback?${new URLSearchParams({ state: flow.state, code })}`);
    assert.equal(repeat.status, 400);
    assert.equal(requests.length, 2);
    const session = await fetch(`${base}/auth/session`);
    assert.equal(session.status, 401);
  });

  it("recusa state ausente, diferente, duplicado ou sem cookie antes de chamar a Nuvemshop", async () => {
    const flow = await startFlow();
    for (const [path, cookie] of [
      [`/callback?code=${code}`, flow.cookie],
      [`/callback?state=${"a".repeat(64)}&code=${code}`, flow.cookie],
      [`/callback?state=${flow.state}&state=${flow.state}&code=${code}`, flow.cookie],
      [`/callback?state=${flow.state}&code=${code}`, undefined],
    ]) {
      assert.equal((await request(path!, cookie)).status, 400);
    }
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("recusa cookie adulterado, expirado, de outro app/loja ou do login interno", async () => {
    const flow = await startFlow();
    const claims = decodeJwt(decodeURIComponent(flow.cookie.split("=")[1]));
    const key = new TextEncoder().encode(secret);
    const invalid = [
      { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
      { ...claims, aud: "portero-api" },
      { ...claims, sub: "b".repeat(64) },
      { ...claims, clientId: "999" },
      { ...claims, demoStoreId: "999" },
      { ...claims, exp: undefined },
    ];
    const cookies = [`${OAUTH_COOKIE}=adulterado`, `${SESSION_COOKIE}=${flow.cookie.split("=")[1]}`];
    for (const payload of invalid) {
      const signed = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(key);
      cookies.push(`${OAUTH_COOKIE}=${signed}`);
    }
    for (const cookie of cookies) {
      assert.equal((await request(`/callback?state=${flow.state}&code=${code}`, cookie)).status, 400);
    }
    assert.equal(requests.length, 0);
  });

  it("trata recusa da autorização e code ausente, vazio ou duplicado", async () => {
    const flow = await startFlow();
    for (const suffix of ["&error=access_denied&error_description=nao-expor", "", "&code=", `&code=${code}&code=outro`]) {
      const result = await request(`/callback?state=${flow.state}${suffix}`, flow.cookie);
      assert.equal(result.status, 400);
      assert.ok(!result.text.includes("nao-expor"));
    }
    assert.equal(requests.length, 0);
  });

  it("não disponibiliza as rotas fora de development ou sem configuração", async () => {
    for (const target of disabledBases) {
      for (const path of ["/setup", "/authorize", "/callback"]) {
        assert.equal((await request(path, undefined, target)).status, 404);
      }
      assert.equal((await fetch(`${target}/health`)).status, 200);
      assert.equal((await fetch(`${target}/auth/session`)).status, 401);
    }
    assert.equal(requests.length, 0);
  });

  it("recusa respostas inválidas do token sem consultar ou salvar a loja", async () => {
    const invalid = [null, [], {}, { ...token, access_token: "" }, { ...token, access_token: "x\r\ny" },
      { ...token, token_type: "outro" }, { ...token, scope: [] }, { ...token, scope: "" },
      { ...token, user_id: 0 }, { ...token, user_id: Number.MAX_SAFE_INTEGER + 1 }];
    for (const body of invalid) {
      requests = [];
      respond = async () => Response.json(body);
      assert.equal((await callback(await startFlow())).status, 502);
      assert.equal(requests.length, 1);
    }
    assert.equal(saved.length, 0);
  });

  it("recusa loja diferente da demo antes de consultar dados e persistir", async () => {
    respond = async () => Response.json({ ...token, user_id: "999" });
    assert.equal((await callback(await startFlow())).status, 403);
    assert.equal(requests.length, 1);
    assert.equal(saved.length, 0);
  });

  it("valida identidade e nome retornados por GET /store", async () => {
    for (const body of [null, [], { ...store, id: 999 }, { ...store, name: "Demo" },
      { ...store, name: {} }, { ...store, name: { pt: " " } }]) {
      requests = [];
      respond = async (index) => Response.json(index === 0 ? token : body);
      assert.equal((await callback(await startFlow())).status, 502);
    }
    assert.equal(saved.length, 0);
  });

  it("aceita ID numérico no token e nome no idioma disponível", async () => {
    respond = async (index) => Response.json(index === 0
      ? { ...token, user_id: Number(config.demoStoreId) }
      : { ...store, main_language: "es", name: { es: " Tienda demo " } });
    assert.equal((await callback(await startFlow())).status, 200);
    assert.equal(saved[0].nomeLoja, "Tienda demo");
  });

  it("trata HTTP 4xx/5xx e JSON inválido em ambas as chamadas sem expor o corpo remoto", async () => {
    for (const failedIndex of [0, 1]) {
      for (const status of [401, 429, 500, 200]) {
        requests = [];
        respond = async (index) => index === failedIndex
          ? new Response(`${token.access_token} ${config.clientSecret} ${code}`, { status })
          : Response.json(token);
        assert.equal((await callback(await startFlow())).status, 502);
      }
    }
    assert.equal(saved.length, 0);
  });

  it("trata falha de rede sem expor mensagens externas", async () => {
    respond = async () => { throw new Error(`${token.access_token} ${config.clientSecret} ${code}`); };
    assert.equal((await callback(await startFlow())).status, 502);
    assert.equal(saved.length, 0);
  });

  it("interrompe por timeout tanto a troca do code como a leitura do corpo da loja", async () => {
    for (const failedIndex of [0, 1]) {
      requests = [];
      respond = async (index, init) => {
        if (index !== failedIndex) return Response.json(token);
        const stalled = new Promise<never>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        });
        // O timeout também deve cobrir a leitura do corpo após o recebimento dos headers.
        return failedIndex === 0 ? stalled : { ok: true, json: () => stalled } as Response;
      };
      assert.equal((await callback(await startFlow())).status, 504);
    }
    assert.equal(saved.length, 0);
  });

  it("não informa sucesso se a persistência falhar e não expõe o erro do banco", async () => {
    databaseFailure = true;
    assert.equal((await callback(await startFlow())).status, 500);
    assert.equal(saved.length, 0);
  });

  it("sem ID inicia somente a configuração explícita, sem autorizar uma conexão", async () => {
    assert.equal((await request("/authorize", undefined, setupBase)).status, 409);
    const flow = await startFlow(setupBase, "/setup");
    const claims = decodeJwt(decodeURIComponent(flow.cookie.split("=")[1]));
    assert.equal(claims.mode, "setup");
    assert.equal(claims.demoStoreId, "");
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("a descoberta retorna apenas um ID candidato, sem consultar a loja nem persistir o token", async () => {
    databaseFailure = true;
    const result = await callback(await startFlow(setupBase, "/setup"), setupSecondBase);
    assert.equal(result.status, 200);
    const body = JSON.parse(result.text);
    assert.equal(body.requiresConfiguration, true);
    assert.equal(body.nuvemshopStoreId, config.demoStoreId);
    assert.deepEqual(Object.keys(body).sort(), ["message", "nuvemshopStoreId", "requiresConfiguration"]);
    assert.match(body.message, /Confirme/);
    assert.match(result.headers.getSetCookie()[0], new RegExp(`^${OAUTH_COOKIE}=;`));
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://www.nuvemshop.com.br/apps/authorize/token");
    assert.equal(saved.length, 0);
  });

  it("exige state válido também na configuração inicial", async () => {
    const flow = await startFlow(setupBase, "/setup");
    for (const cookie of [undefined, `${OAUTH_COOKIE}=adulterado`]) {
      assert.equal((await request(`/callback?state=${flow.state}&code=${code}`, cookie, setupBase)).status, 400);
    }
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("não reutiliza o fluxo de descoberta após configurar o ID nem aceita o modo da query", async () => {
    const setup = await startFlow(setupBase, "/setup");
    assert.equal((await callback(setup, base)).status, 400);
    const connected = await startFlow();
    assert.equal((await callback(connected, setupBase)).status, 400);
    assert.equal((await request("/setup", undefined, base)).status, 409);
    assert.equal((await request("/authorize?mode=setup", undefined, setupBase)).status, 409);
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("depois da confirmação do ID exige nova autorização e conecta somente a loja configurada", async () => {
    const discovery = await callback(await startFlow(setupBase, "/setup"), setupBase);
    const id = JSON.parse(discovery.text).nuvemshopStoreId;
    assert.equal(saved.length, 0);
    const configuredBase = await startServer("development", true, id);
    requests = [];
    assert.equal((await request("/setup", undefined, configuredBase)).status, 409);
    const result = await callback(await startFlow(configuredBase), configuredBase);
    assert.equal(result.status, 200);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].nuvemshopStoreId, id);
    assert.equal(requests.length, 2);
  });

  it("o cliente não conecta sem ID nem descobre outro ID depois da configuração", async () => {
    await assert.rejects(createNuvemshopClient({ ...config, demoStoreId: "" }, fetcher).connect(code), { status: 409 });
    await assert.rejects(createNuvemshopClient(config, fetcher).discoverStoreId(code), { status: 409 });
    assert.equal(requests.length, 0);
  });
});

it("configura OAuth somente em desenvolvimento e permite o ID ausente para a primeira configuração", () => {
  const env = { NODE_ENV: "development", NUVEMSHOP_CLIENT_ID: config.clientId,
    NUVEMSHOP_CLIENT_SECRET: config.clientSecret, NUVEMSHOP_DEMO_STORE_ID: config.demoStoreId,
    NUVEMSHOP_USER_AGENT: config.userAgent };
  assert.deepEqual(readNuvemshopConfig(env), config);
  assert.deepEqual(readNuvemshopConfig({ ...env, NUVEMSHOP_DEMO_STORE_ID: undefined }), { ...config, demoStoreId: "" });
  assert.deepEqual(readNuvemshopConfig({ ...env, NUVEMSHOP_DEMO_STORE_ID: "" }), { ...config, demoStoreId: "" });
  assert.equal(readNuvemshopConfig({ ...env, NODE_ENV: "production" }), undefined);
  assert.equal(readNuvemshopConfig({ ...env, NODE_ENV: undefined }), undefined);
  assert.equal(readNuvemshopConfig({ NODE_ENV: "development" }), undefined);
  for (const change of [{ NUVEMSHOP_CLIENT_ID: "../outro" }, { NUVEMSHOP_CLIENT_SECRET: "" },
    { NUVEMSHOP_DEMO_STORE_ID: "0" }, { NUVEMSHOP_USER_AGENT: "app\r\ninvalido" }]) {
    assert.throws(() => readNuvemshopConfig({ ...env, ...change }), (error: Error) => {
      assert.ok(!error.message.includes(config.clientSecret));
      return true;
    });
  }
});
