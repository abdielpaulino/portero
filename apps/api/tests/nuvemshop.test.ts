import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { decodeJwt, SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { SESSION_COOKIE } from "../src/auth/session.js";
import { createNuvemshopClient, NuvemshopError, readNuvemshopConfig, type LojaConectada } from "../src/nuvemshop/oauth.js";
import { OAUTH_COOKIE, OAUTH_SECONDS } from "../src/nuvemshop/routes.js";
import type { AuthorizationAttempt } from "../src/nuvemshop/repository.js";

const secret = "segredo-apenas-dos-testes-offline-com-32-bytes";
const config = { clientId: "12345", clientSecret: "segredo-ficticio-nao-expor",
  storeId: "67890", userAgent: "PORTERO (dev@example.test)", apiOrigin: "http://localhost:3001", installationId: "offline-test", adminToken: "administracao-ficticia-com-mais-de-32-bytes" };
const token = { access_token: "token-ficticio-nao-expor", token_type: "bearer",
  scope: "read_products,write_products,read_locations", user_id: config.storeId };
const store = { id: Number(config.storeId), main_language: "pt", name: { pt: "Loja demo", es: "Tienda demo" } };
const code = "code-ficticio-nao-expor";

describe("OAuth Nuvemshop sem banco e com API externa simulada", { concurrency: false }, () => {
  const servers: Server[] = [];
  let base: string;
  let secondBase: string;
  let setupBase: string;
  let unguardedBase: string;
  let disabledBases: string[];
  let requests: { url: string; init: RequestInit }[];
  let saved: LojaConectada[];
  let databaseFailure: boolean;
  type RecordState = { generation: string; state: "initialized" | "authorizing" | "consumed" | "active" | "closed" };
  let lifecycleRecord: RecordState | undefined;
  let lifecycleFailure = false;
  function resetInstallationFixture() {
    lifecycleRecord = { generation: "1730000000.000001", state: "initialized" };
    lifecycleFailure = false;
  }
  async function closeInstallationFixture() { lifecycleRecord = { generation: lifecycleRecord?.generation ?? "", state: "closed" }; }
  function assertPhase(expected: RecordState["state"], attempt?: AuthorizationAttempt) {
    if (lifecycleFailure) throw new NuvemshopError(503, "Banco indisponível");
    if (!lifecycleRecord || lifecycleRecord.state !== expected || (attempt && (attempt.lojaId !== 8 || attempt.generation !== lifecycleRecord.generation)))
      throw new NuvemshopError(409, "Autorização bloqueada");
  }
  let respond: (index: number, init: RequestInit) => Promise<Response>;

  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init! });
    return respond(requests.length - 1, init!);
  };

  async function startServer(environment: string, enabled = true, storeId = config.storeId, guarded = true) {
    const serverConfig = { ...config, storeId };
    const server = createApp({
      jwtSecret: secret, environment,
      repository: {
        async buscarUsuariosPorEmail() { throw new Error("OAuth não deve consultar usuários"); },
        async listarLojas() { throw new Error("OAuth não deve consultar associações"); },
      },
      nuvemshop: enabled ? {
        config: serverConfig, client: createNuvemshopClient(serverConfig, fetcher, 50),
        repository: {
          async verificarInstalacao() { assertPhase("active"); },
          async prepararAutorizacao() {
            if (!guarded || !storeId) throw new NuvemshopError(409, "Loja não preparada");
            assertPhase("initialized"); return { lojaId: 8, generation: lifecycleRecord!.generation };
          },
          async iniciarAutorizacao() {
            const value = await this.prepararAutorizacao(storeId);
            assertPhase("initialized"); lifecycleRecord!.state = "authorizing"; return value;
          },
          async consumirAutorizacao(_storeId, attempt) { assertPhase("authorizing", attempt); lifecycleRecord!.state = "consumed"; },
          async salvarLoja(loja, attempt) {
            if (databaseFailure) throw new Error(`${token.access_token} ${config.clientSecret} ${code}`);
            assertPhase("consumed", attempt); saved.push(loja); lifecycleRecord!.state = "active";
          },
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
    base = await startServer("production");
    secondBase = await startServer("production");
    setupBase = await startServer("development", true, "");
    unguardedBase = await startServer("production", true, config.storeId, false);
    disabledBases = [await startServer("production", false), await startServer("development", false)];
  });

  beforeEach(() => {
    resetInstallationFixture();
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
      redirect: "manual", method: /^\/(authorize|setup)(\?|$)/.test(path) ? "POST" : "GET",
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(/^\/(authorize|setup)(\?|$)/.test(path) ? { Authorization: `Bearer ${config.adminToken}` } : {}) },
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
    assert.equal(result.status, 303);
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
    resetInstallationFixture();
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
    assert.equal(claims.lifecycleGeneration, lifecycleRecord!.generation);
    assert.equal(first.result.headers.get("Cache-Control"), "no-store");
    assert.equal(first.result.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(requests.length, 0);
  });

  it("aceita callback em outra instância, troca code no backend e salva apenas a loja demo", async () => {
    const flow = await startFlow();
    const result = await callback(flow, secondBase);
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.text).loja, { nuvemshopStoreId: config.storeId, nomeLoja: "Loja demo" });
    assert.deepEqual(saved, [{ nuvemshopStoreId: config.storeId, accessToken: token.access_token,
      scope: token.scope, nomeLoja: "Loja demo" }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://www.nuvemshop.com.br/apps/authorize/token");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body as string), {
      client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code,
    });
    assert.equal(requests[1].url, `https://api.nuvemshop.com.br/2025-03/${config.storeId}/store`);
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
      { ...claims, storeId: "999" },
      { ...claims, exp: undefined },
      { ...claims, lifecycleGeneration: undefined },
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
    for (const suffix of ["&error=access_denied&error_description=nao-expor", "", "&code=", `&code=${code}&code=outro`]) {
      resetInstallationFixture();
      const flow = await startFlow();
      const result = await request(`/callback?state=${flow.state}${suffix}`, flow.cookie);
      assert.equal(result.status, 400);
      assert.ok(!result.text.includes("nao-expor"));
    }
    assert.equal(requests.length, 0);
  });

  it("não disponibiliza OAuth sem configuração", async () => {
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
      resetInstallationFixture();
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
      resetInstallationFixture();
      requests = [];
      respond = async (index) => Response.json(index === 0 ? token : body);
      assert.equal((await callback(await startFlow())).status, 502);
    }
    assert.equal(saved.length, 0);
  });

  it("aceita ID numérico no token e nome no idioma disponível", async () => {
    respond = async (index) => Response.json(index === 0
      ? { ...token, user_id: Number(config.storeId) }
      : { ...store, main_language: "es", name: { es: " Tienda demo " } });
    assert.equal((await callback(await startFlow())).status, 200);
    assert.equal(saved[0].nomeLoja, "Tienda demo");
  });

  it("trata HTTP 4xx/5xx e JSON inválido em ambas as chamadas sem expor o corpo remoto", async () => {
    for (const failedIndex of [0, 1]) {
      for (const status of [401, 429, 500, 200]) {
        resetInstallationFixture();
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
      resetInstallationFixture();
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
    assert.equal((await callback(await startFlow())).status, 503);
    assert.equal(saved.length, 0);
  });

  it("sem ID fixado não inicia OAuth nem oferece descoberta automática", async () => {
    assert.equal((await request("/authorize", undefined, setupBase)).status, 409);
    assert.equal((await request("/setup", undefined, setupBase)).status, 409);
    const page = await request("/install", undefined, setupBase);
    assert.equal(page.status, 409);
    assert.ok(!page.text.includes("<form"));
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("sem controle de instalação configurado não inicia OAuth", async () => {
    assert.equal((await request("/authorize", undefined, unguardedBase)).status, 409);
    assert.equal(requests.length, 0);
  });

  it("controle ausente ou indisponível bloqueia conexão e callback antes da chamada remota", async () => {
    const flow = await startFlow();
    lifecycleRecord = undefined;
    assert.equal((await callback(flow, secondBase)).status, 409);
    assert.equal((await request("/authorize")).status, 409);
    resetInstallationFixture();
    lifecycleFailure = true;
    assert.equal((await request("/authorize")).status, 503);
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("bloqueio terminal impede callbacks antigos e outra autorização entre instâncias e reinício", async () => {
    const flow = await startFlow();
    await closeInstallationFixture();
    assert.equal((await callback(flow, secondBase)).status, 409);
    const restarted = await startServer("production");
    assert.equal((await callback(flow, restarted)).status, 409);
    assert.equal((await request("/authorize", undefined, restarted)).status, 409);
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("cookie de outra geração não usa uma autorização da instalação atual", async () => {
    const flow = await startFlow();
    const claims = decodeJwt(decodeURIComponent(flow.cookie.split("=")[1]));
    const signed = await new SignJWT({ ...claims, lifecycleGeneration: "22222222-2222-4222-8222-222222222222" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(new TextEncoder().encode(secret));
    assert.equal((await request(`/callback?state=${flow.state}&code=${code}`, `${OAUTH_COOKIE}=${signed}`)).status, 409);
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("não aceita descoberta, modo da query ou callback em configuração de outra loja", async () => {
    const flow = await startFlow();
    assert.equal((await callback(flow, setupBase)).status, 400);
    assert.equal((await request("/setup", undefined, base)).status, 409);
    assert.equal((await request("/authorize?mode=setup", undefined, setupBase)).status, 409);
    assert.equal(requests.length, 0);
    assert.equal(saved.length, 0);
  });

  it("uma instalação ativa não inicia nova autorização nem renova o token automaticamente", async () => {
    assert.equal((await callback(await startFlow())).status, 200);
    assert.equal((await request("/authorize", undefined, secondBase)).status, 409);
    assert.equal(saved.length, 1);
    assert.equal(requests.length, 2);
  });

  it("desinstalação durante a resposta remota impede a gravação de novas credenciais", async () => {
    respond = async (index) => {
      if (index === 0) return Response.json(token);
      await closeInstallationFixture();
      return Response.json(store);
    };
    assert.equal((await callback(await startFlow())).status, 409);
    assert.equal(saved.length, 0);
    assert.equal(lifecycleRecord!.state, "closed");
    assert.equal((await request("/authorize")).status, 409);
    assert.equal(requests.length, 2);
  });

  it("o cliente não conecta sem ID nem descobre outro ID depois da configuração", async () => {
    await assert.rejects(createNuvemshopClient({ ...config, storeId: "" }, fetcher).connect(code), { status: 409 });
    await assert.rejects(createNuvemshopClient(config, fetcher).discoverStoreId(code), { status: 409 });
    assert.equal(requests.length, 0);
  });

  it("exige autorização administrativa e não inicia OAuth por um link GET", async () => {
    for (const headers of [{}, { Authorization: "Bearer incorreto" }]) {
      const response = await fetch(`${base}/auth/nuvemshop/authorize`, { method: "POST", headers, redirect: "manual" });
      assert.equal(response.status, 403);
    }
    assert.equal((await fetch(`${base}/auth/nuvemshop/authorize`)).status, 404);
    const form = await fetch(`${base}/auth/nuvemshop/authorize`, { method: "POST", redirect: "manual",
      headers: { Origin: "http://localhost:3001", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ adminToken: config.adminToken }) });
    assert.equal(form.status, 303);
    assert.equal(requests.length, 0);
  });

  it("consome state uma única vez entre instâncias e após reinicialização", async () => {
    const flow = await startFlow();
    const results = await Promise.all([callback(flow), callback(flow, secondBase)]);
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.ok(results.some(result => result.status === 400 || result.status === 409));
    assert.equal(requests.length, 2);
    const restarted = await startServer("production");
    assert.ok([400, 409].includes((await callback(flow, restarted)).status));
    assert.equal(requests.length, 2);
  });

  it("mantém o state consumido após falha remota sem repetir a troca do code", async () => {
    respond = async () => { throw new Error("falha simulada"); };
    const flow = await startFlow();
    assert.equal((await callback(flow)).status, 502);
    assert.equal((await callback(flow, secondBase)).status, 409);
    assert.equal((await request("/authorize", undefined, secondBase)).status, 409);
    assert.equal(lifecycleRecord!.state, "consumed");
    assert.equal(requests.length, 1);
  });


});

it("configura OAuth para uma instalação com origens e segredo administrativo válidos", () => {
  const env = { NODE_ENV: "development", NUVEMSHOP_CLIENT_ID: config.clientId,
    NUVEMSHOP_CLIENT_SECRET: config.clientSecret, NUVEMSHOP_STORE_ID: config.storeId,
    NUVEMSHOP_USER_AGENT: config.userAgent, API_PUBLIC_URL: config.apiOrigin,
    PORTERO_INSTALLATION_ID: config.installationId, INSTALLATION_ADMIN_TOKEN: config.adminToken };
  assert.deepEqual(readNuvemshopConfig(env), config);
  assert.equal(readNuvemshopConfig({ NODE_ENV: "development" }), undefined);
  assert.equal(readNuvemshopConfig({ ...env, NUVEMSHOP_STORE_ID: "" })?.storeId, "");
  const production = { ...env, NODE_ENV: "production", API_PUBLIC_URL: "https://api.example.test" };
  assert.equal(readNuvemshopConfig(production)?.storeId, config.storeId);
  for (const change of [{ NUVEMSHOP_CLIENT_ID: "../outro" }, { NUVEMSHOP_CLIENT_SECRET: "" },
    { NUVEMSHOP_STORE_ID: "0" }, { NUVEMSHOP_USER_AGENT: "app\r\ninvalido" }, { INSTALLATION_ADMIN_TOKEN: "curto" },
    { API_PUBLIC_URL: "https://api.example.test/" }, { PORTERO_INSTALLATION_ID: "" }, { NUVEMSHOP_DEMO_STORE_ID: "67890" },
    { API_PUBLIC_URL: "http://api.example.test" }]) {
    assert.throws(() => readNuvemshopConfig({ ...production, ...change }), (error: Error) => {
      assert.ok(!error.message.includes(config.clientSecret)); return true;
    });
  }
});
