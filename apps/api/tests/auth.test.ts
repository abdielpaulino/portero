import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { hashSync } from "bcryptjs";
import { decodeJwt, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createApp } from "../src/app.js";
import type { AuthRepository, LojaLogin, UsuarioLogin } from "../src/auth/repository.js";
import { SELECTION_COOKIE, SELECTION_SECONDS, SESSION_COOKIE, SESSION_SECONDS } from "../src/auth/session.js";

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

  async function startServer() {
    const server = createApp({ repository, jwtSecret: secret, secureCookies: false }).listen(0, "127.0.0.1");
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

  it("para várias lojas emite somente token temporário com audience e propósito próprios", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const result = await login();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { requiresStoreSelection: true, lojas: [lojaA, lojaB] });
    assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
    const selection = setCookie(result.headers, SELECTION_COOKIE);
    assert.match(selection.header, /HttpOnly/i);
    assert.match(selection.header, new RegExp(`Max-Age=${SELECTION_SECONDS}(?:;|$)`));
    const { payload } = await jwtVerify(selection.value, key, { audience: "portero-store-selection", issuer: "portero" });
    assert.equal(payload.sub, String(usuario.id));
    assert.equal(payload.purpose, "store-selection");
    assert.equal(payload.exp! - payload.iat!, SELECTION_SECONDS);
    assert.equal(payload.lojaId, undefined);
    assert.equal(payload.senhaHash, undefined);
    assert.equal(payload.password, undefined);
    assert.ok(!JSON.stringify(result.body).includes(senhaHash));
  });

  it("conclui a escolha em outra instância e usa a loja do JWT na rota protegida", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const pending = await login();
    const selection = setCookie(pending.headers, SELECTION_COOKIE);
    const selected = await request("/auth/select-store", {
      body: { lojaId: lojaB.id }, cookie: selection.cookie, base: secondBaseUrl,
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(selected.body.loja, lojaB);
    assert.equal(setCookie(selected.headers, SELECTION_COOKIE).value, "");
    const session = setCookie(selected.headers, SESSION_COOKIE);
    const result = await request(`/auth/session?lojaId=${lojaA.id}`, { cookie: session.cookie });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { usuarioId: usuario.id, loja: lojaB });
  });

  it("exige token temporário válido para escolher a loja", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const pending = await login();
    const selection = setCookie(pending.headers, SELECTION_COOKIE);
    const claims = decodeJwt(selection.value);
    const expired = await sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 });
    const wrongSignature = await sign(claims, new TextEncoder().encode("outro-segredo-de-testes-com-mais-de-32-bytes"));
    const wrongPurpose = await sign({ ...claims, purpose: "session" });
    const accessToken = await sign(sessionClaims());
    for (const token of [undefined, "inválido", expired, wrongSignature, wrongPurpose, accessToken]) {
      const result = await request("/auth/select-store", {
        body: { lojaId: lojaA.id }, cookie: token ? `${SELECTION_COOKIE}=${token}` : undefined,
      });
      assert.equal(result.status, 401);
      assert.equal(setCookie(result.headers, SELECTION_COOKIE).value, "");
    }
  });

  it("valida a escolha e recusa loja fora da associação", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const pending = await login();
    const cookie = setCookie(pending.headers, SELECTION_COOKIE).cookie;
    for (const lojaId of ["10", 0, -1, 1.5, null]) {
      const result = await request("/auth/select-store", { body: { lojaId }, cookie });
      assert.equal(result.status, 400);
    }
    const forbidden = await request("/auth/select-store", { body: { lojaId: 999 }, cookie });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.getSetCookie().some((item) => item.startsWith(`${SESSION_COOKIE}=`)), false);
  });

  it("reconsulta as associações antes de concluir a seleção", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const pending = await login();
    lojasPorUsuario.set(usuario.id, [lojaA]);
    const result = await request("/auth/select-store", {
      body: { lojaId: lojaB.id }, cookie: setCookie(pending.headers, SELECTION_COOKIE).cookie,
    });
    assert.equal(result.status, 403);
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

  it("não aceita token de seleção como sessão de acesso", async () => {
    lojasPorUsuario.set(usuario.id, [lojaA, lojaB]);
    const pending = await login();
    const token = setCookie(pending.headers, SELECTION_COOKIE).value;
    const result = await request("/auth/session", { cookie: `${SESSION_COOKIE}=${token}` });
    assert.equal(result.status, 401);
  });

  it("recusa a sessão e limpa o cookie quando o acesso à loja foi revogado", async () => {
    const authenticated = await login();
    lojasPorUsuario.set(usuario.id, []);
    const result = await request("/auth/session", { cookie: setCookie(authenticated.headers, SESSION_COOKIE).cookie });
    assert.equal(result.status, 403);
    assert.equal(setCookie(result.headers, SESSION_COOKIE).value, "");
  });
});
