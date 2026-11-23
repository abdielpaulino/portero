import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { hashSync } from "bcryptjs";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createApp } from "../src/app.js";
import type { AuthRepository, LojaLogin, UsuarioLogin } from "../src/auth/repository.js";
import { SESSION_COOKIE, SESSION_SECONDS } from "../src/auth/session.js";

const secret = "segredo-apenas-dos-testes-offline-com-32-bytes";
const key = new TextEncoder().encode(secret);
const password = "senha de teste";
const senhaHash = hashSync(password, 4);
const lojaA: LojaLogin = { id: 10, nomeLoja: "Loja A" };
const lojaB: LojaLogin = { id: 20, nomeLoja: "Loja B" };
const usuario: UsuarioLogin = { id: 1, nome: "Ana", email: "ana@example.test", senhaHash };

describe("autenticação sem banco", { concurrency: false }, () => {
  const servers: Server[] = [];
  let baseUrl: string;
  let secondBaseUrl: string;
  let usuarios: UsuarioLogin[];
  let lojasPorUsuario: Map<number, LojaLogin[]>;
  let emailsConsultados: string[];

  const repository: AuthRepository = {
    async buscarUsuariosPorEmail(email) {
      emailsConsultados.push(email);
      return usuarios.filter((item) => item.email.trim().toLowerCase() === email);
    },
    async listarLojas(usuarioId) {
      return lojasPorUsuario.get(usuarioId) ?? [];
    },
  };

  async function startServer(webOrigin?: string) {
    const server = createApp({ repository, jwtSecret: secret, secureCookies: false, webOrigin }).listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }

  before(async () => {
    baseUrl = await startServer();
    secondBaseUrl = await startServer();
  });

  beforeEach(() => {
    usuarios = [{ ...usuario }];
    lojasPorUsuario = new Map([[usuario.id, [lojaA]]]);
    emailsConsultados = [];
  });

  after(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
  });

  async function request(path: string, options: { body?: unknown; cookie?: string; base?: string } = {}) {
    const response = await fetch(`${options.base ?? baseUrl}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, unknown> };
  }

  function setCookie(headers: Headers, name: string) {
    const header = headers.getSetCookie().filter((item) => item.startsWith(`${name}=`)).at(-1);
    assert.ok(header, `Cookie ${name} ausente`);
    const cookie = header.split(";")[0];
    return { header, cookie, value: decodeURIComponent(cookie.slice(name.length + 1)) };
  }

  function login(body: unknown = { email: usuario.email, password }) {
    return request("/auth/login", { body });
  }

  async function sign(payload: JWTPayload, signingKey = key) {
    return new SignJWT(payload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(signingKey);
  }

  function sessionClaims(overrides: JWTPayload = {}): JWTPayload {
    const now = Math.floor(Date.now() / 1000);
    return {
      sub: String(usuario.id), iss: "portero", aud: "portero-api", purpose: "session",
      iat: now, exp: now + SESSION_SECONDS, lojaId: lojaA.id, ...overrides,
    };
  }

  it("autentica uma loja, normaliza o e-mail e emite JWT com expiração em cookie HttpOnly", async () => {
    const result = await login({ email: "  ANA@EXAMPLE.TEST  ", password });
    assert.equal(result.status, 200);
    assert.deepEqual(emailsConsultados, [usuario.email]);
    assert.deepEqual(result.body, {
      requiresStoreSelection: false,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
      loja: lojaA,
    });
    const cookie = setCookie(result.headers, SESSION_COOKIE);
    assert.match(cookie.header, /HttpOnly/i);
    assert.match(cookie.header, /SameSite=Lax/i);
    assert.match(cookie.header, new RegExp(`Max-Age=${SESSION_SECONDS}(?:;|$)`));
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    const { payload } = await jwtVerify(cookie.value, key, { issuer: "portero", audience: "portero-api", algorithms: ["HS256"] });
    assert.equal(payload.sub, String(usuario.id));
    assert.equal(payload.lojaId, lojaA.id);
    assert.equal(payload.purpose, "session");
    assert.equal(payload.exp! - payload.iat!, SESSION_SECONDS);
    assert.equal(payload.senhaHash, undefined);
    assert.equal(payload.password, undefined);
    assert.ok(!JSON.stringify(result.body).includes(senhaHash));
  });

  it("responde de forma genérica para senha incorreta, usuário inexistente e e-mail duplicado", async () => {
    const wrongPassword = await login({ email: usuario.email, password: "outra senha" });
    const unknown = await login({ email: "ausente@example.test", password });
    usuarios.push({ ...usuario, id: 2, email: " ANA@EXAMPLE.TEST " });
    const duplicate = await login();
    for (const result of [wrongPassword, unknown, duplicate]) {
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { message: "E-mail ou senha inválidos." });
      assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
    }
  });

  it("valida os campos e o limite em bytes da senha antes de consultar o usuário", async () => {
    const invalidBodies = [
      {}, { email: "inválido", password }, { email: 123, password },
      { email: usuario.email, password: "" }, { email: usuario.email, password: 123 },
      { email: usuario.email, password: "a".repeat(73) },
      { email: usuario.email, password: "á".repeat(37) },
      { email: `${"a".repeat(255)}@example.test`, password },
    ];
    for (const body of invalidBodies) {
      const result = await login(body);
      assert.equal(result.status, 400);
      assert.equal(typeof result.body.message, "string");
    }
    assert.deepEqual(emailsConsultados, []);
  });

  it("recusa hash incompatível sem expor o valor armazenado", async () => {
    usuarios[0].senhaHash = "hash-legado-incompatível";
    const result = await login();
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { message: "E-mail ou senha inválidos." });
  });

  it("recusa conta sem associação a lojas", async () => {
    lojasPorUsuario.set(usuario.id, []);
    const result = await login();
    assert.equal(result.status, 403);
    assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
  });

  it("recusa associações ambíguas sem escolher uma loja ou emitir token de seleção", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const result = await login();
    assert.equal(result.status, 403);
    assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
    assert.equal(result.body.lojas, undefined);
    assert.equal(result.body.requiresStoreSelection, undefined);
    assert.equal(setCookie(result.headers, "portero_store_selection").value, "");
  });

  it("usa a loja associada no servidor e ignora IDs enviados no login e na sessão", async () => {
    const authenticated = await login({ email: usuario.email, password, lojaId: lojaB.id });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(authenticated.body.loja, lojaA);
    const session = setCookie(authenticated.headers, SESSION_COOKIE);
    const { payload } = await jwtVerify(session.value, key, { audience: "portero-api", issuer: "portero" });
    assert.equal(payload.lojaId, lojaA.id);
    const result = await request(`/auth/session?lojaId=${lojaB.id}`, { cookie: session.cookie, base: secondBaseUrl });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { usuarioId: usuario.id, loja: lojaA, baixasHabilitadas: false });
  });

  it("não autentica uma conta sem associação mesmo que o frontend informe uma loja", async () => {
    lojasPorUsuario.set(usuario.id, []);
    const result = await login({ email: usuario.email, password, lojaId: lojaA.id });
    assert.equal(result.status, 403);
    assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
  });

  it("remove a rota de seleção de loja mesmo para uma sessão autenticada", async () => {
    const authenticated = await login();
    const result = await fetch(`${baseUrl}/auth/select-store`, {
      method: "POST", headers: { "Content-Type": "application/json",
        Cookie: setCookie(authenticated.headers, SESSION_COOKIE).cookie },
      body: JSON.stringify({ lojaId: lojaB.id }),
    });
    assert.equal(result.status, 404);
    const session = await request("/auth/session", { cookie: setCookie(authenticated.headers, SESSION_COOKIE).cookie });
    assert.deepEqual(session.body, { usuarioId: usuario.id, loja: lojaA, baixasHabilitadas: false });
  });

  it("protege a sessão contra token ausente, adulterado, expirado ou sem contexto válido", async () => {
    const claims = sessionClaims();
    const wrongSignature = await sign(claims, new TextEncoder().encode("outro-segredo-de-testes-com-mais-de-32-bytes"));
    const noExpiration = { ...claims };
    delete noExpiration.exp;
    const invalidTokens = [
      undefined, "inválido", wrongSignature,
      await sign(sessionClaims({ exp: Math.floor(Date.now() / 1000) - 1 })),
      await sign(sessionClaims({ lojaId: undefined })),
      await sign(sessionClaims({ lojaId: "10" })),
      await sign(sessionClaims({ sub: "0" })),
      await sign(sessionClaims({ purpose: "store-selection" })),
      await sign(sessionClaims({ aud: "outro-serviço" })),
      await sign(noExpiration),
    ];
    for (const token of invalidTokens) {
      const result = await request("/auth/session", { cookie: token ? `${SESSION_COOKIE}=${token}` : undefined });
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { message: "Sessão inválida ou expirada." });
    }
  });

  it("recusa tokens antigos de seleção e limpa o cookie legado no próximo login", async () => {
    const token = await sign(sessionClaims({ aud: "portero-store-selection", purpose: "store-selection",
      lojaId: undefined, nome: usuario.nome, email: usuario.email }));
    const result = await request("/auth/session", { cookie: `${SESSION_COOKIE}=${token}` });
    assert.equal(result.status, 401);
    const authenticated = await request("/auth/login", {
      body: { email: usuario.email, password }, cookie: `portero_store_selection=${token}`,
    });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(authenticated.body.loja, lojaA);
    assert.equal(setCookie(authenticated.headers, "portero_store_selection").value, "");
  });

  it("recusa a sessão quando a associação foi revogada, trocada ou se tornou ambígua", async () => {
    for (const lojas of [[], [lojaB], [lojaA, lojaB]]) {
      lojasPorUsuario.set(usuario.id, [lojaA]);
      const authenticated = await login();
      lojasPorUsuario.set(usuario.id, lojas);
      const result = await request("/auth/session", { cookie: setCookie(authenticated.headers, SESSION_COOKIE).cookie });
      assert.equal(result.status, 403);
      assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
    }
  });

  it("encerra a sessão no navegador e permite sair mesmo com cookie expirado", async () => {
    const authenticated = await login();
    for (const cookie of [setCookie(authenticated.headers, SESSION_COOKIE).cookie, `${SESSION_COOKIE}=expirado`, undefined]) {
      const result = await fetch(`${baseUrl}/auth/logout`, {
        method: "POST", headers: cookie ? { Cookie: cookie } : {},
      });
      assert.equal(result.status, 204);
      const cleared = setCookie(result.headers, SESSION_COOKIE);
      assert.equal(cleared.value, "");
      assert.match(cleared.header, /HttpOnly/i);
      assert.match(cleared.header, /SameSite=Lax/i);
      assert.match(cleared.header, /Path=\//);
      assert.equal(setCookie(result.headers, "portero_store_selection").value, "");
      assert.equal(result.headers.get("Cache-Control"), "no-store");
      assert.equal((await request("/auth/session", { cookie: cleared.cookie })).status, 401);
    }
  });

  it("recusa origens externas em operações mutantes antes de consultar usuários ou limpar cookies", async () => {
    for (const path of ["/auth/login", "/auth/logout", "/inventory/stock-decreases"]) {
      for (const origin of ["https://outro.example.test", "http://localhost:3000.evil.test", "null"]) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: usuario.email, password }),
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { message: "Origem da solicitação não permitida." });
        assert.deepEqual(response.headers.getSetCookie(), []);
      }
    }
    assert.deepEqual(emailsConsultados, []);
  });

  it("aceita WEB_ORIGIN configurada e requisições administrativas sem Origin", async () => {
    const origin = "https://portero.example.test";
    const target = await startServer(origin);
    for (const requestOrigin of [origin, undefined]) {
      const response = await fetch(`${target}/auth/login`, {
        method: "POST", headers: {
          "Content-Type": "application/json", ...(requestOrigin ? { Origin: requestOrigin } : {}),
        }, body: JSON.stringify({ email: usuario.email, password }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
      assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
      assert.ok(setCookie(response.headers, SESSION_COOKIE).value);
    }
    assert.deepEqual(emailsConsultados, [usuario.email, usuario.email]);
  });
});
