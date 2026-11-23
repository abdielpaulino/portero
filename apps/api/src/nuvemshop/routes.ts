import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express, { Router, type CookieOptions, type RequestHandler } from "express";
import { jwtVerify, SignJWT } from "jose";
import { readCookie } from "../auth/session.js";
import { NuvemshopError, type NuvemshopConfig, type createNuvemshopClient } from "./oauth.js";
import type { AuthorizationAttempt, NuvemshopRepository } from "./repository.js";

export const OAUTH_COOKIE = "portero_nuvemshop_oauth";
export const OAUTH_SECONDS = 5 * 60;
export type NuvemshopOptions = {
  config: NuvemshopConfig;
  client: ReturnType<typeof createNuvemshopClient>;
  repository: NuvemshopRepository;
};
export function createNuvemshopRouter({ config, client, repository }: NuvemshopOptions,
  jwtSecret: string, secureCookies = false) {
  const router = Router();
  const key = new TextEncoder().encode(jwtSecret);
  const cookieOptions: CookieOptions = { httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/auth/nuvemshop" };
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  router.get("/install", async (_req, res) => {
    try {
      await repository.prepararAutorizacao(config.storeId);
      res.type("html").send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Instalação PORTERO</title><h1>Primeira instalação do PORTERO</h1><p>Use o segredo administrativo. Não informe sua senha da Nuvemshop.</p><form method="post" action="/auth/nuvemshop/authorize"><label>Segredo administrativo <input name="adminToken" type="password" required autocomplete="off"></label><button type="submit">Autorizar a primeira instalação</button></form></html>');
    } catch (error) {
      res.status(error instanceof NuvemshopError ? error.status : 503).type("html")
        .send("<h1>Instalação indisponível</h1><p>Solicite conferência administrativa. Não há inicialização, recuperação ou reinstalação automática.</p>");
    }
  });
  router.use(express.urlencoded({ extended: false, limit: "2kb" }));
  const administrative: RequestHandler = (req, res, next) => {
    const bearer = req.get("Authorization");
    const isBearer = bearer?.startsWith("Bearer ") === true;
    const supplied = isBearer ? bearer!.slice(7) : req.body?.adminToken;
    if ((!isBearer && req.get("Origin") !== config.apiOrigin) || typeof supplied !== "string"
      || !timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(config.adminToken).digest())) {
      res.status(403).json({ message: "Autorização administrativa inválida." }); return;
    }
    next();
  };
  router.post("/setup", administrative, (_req, res) => {
    res.status(409).json({ message: "Confirme o ID da loja e a preparação administrativa antes do primeiro OAuth." });
  });
  router.post("/authorize", administrative, async (req, res) => {
    if (Object.keys(req.query).length) { res.status(409).json({ message: "Parâmetros não permitidos." }); return; }
    try {
      const state = randomBytes(32).toString("hex");
      // Só uma transição inicial pode emitir um cookie. Falhas não reabrem o estado.
      const preparation = await repository.iniciarAutorizacao(config.storeId);
      const cookie = await new SignJWT({ clientId: config.clientId, storeId: config.storeId,
        installationId: config.installationId, apiOrigin: config.apiOrigin,
        lojaId: preparation.lojaId, lifecycleGeneration: preparation.generation })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(state)
        .setIssuer("portero").setAudience("portero-nuvemshop-oauth")
        .setIssuedAt().setExpirationTime(`${OAUTH_SECONDS}s`).sign(key);
      res.cookie(OAUTH_COOKIE, cookie, { ...cookieOptions, maxAge: OAUTH_SECONDS * 1000 });
      const url = new URL(`https://www.nuvemshop.com.br/apps/${config.clientId}/authorize`);
      url.searchParams.set("state", state);
      res.redirect(303, url.toString());
    } catch (error) {
      res.status(error instanceof NuvemshopError ? error.status : 503)
        .json({ message: error instanceof NuvemshopError ? error.message : "Não foi possível iniciar a autorização. Solicite conferência administrativa." });
    }
  });
  router.get("/callback", async (req, res) => {
    res.clearCookie(OAUTH_COOKIE, cookieOptions);
    const { state, code, error } = req.query;
    let attempt: AuthorizationAttempt;
    try {
      if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)) throw new Error();
      const { payload } = await jwtVerify(readCookie(req, OAUTH_COOKIE) ?? "", key, {
        algorithms: ["HS256"], issuer: "portero", audience: "portero-nuvemshop-oauth", maxTokenAge: `${OAUTH_SECONDS}s`,
        requiredClaims: ["sub", "iat", "exp", "clientId", "storeId", "installationId", "apiOrigin", "lojaId", "lifecycleGeneration"],
      });
      if (payload.sub !== state || payload.clientId !== config.clientId || payload.storeId !== config.storeId
        || payload.installationId !== config.installationId || payload.apiOrigin !== config.apiOrigin
        || typeof payload.lojaId !== "number" || !Number.isSafeInteger(payload.lojaId) || payload.lojaId <= 0
        || typeof payload.lifecycleGeneration !== "string" || !payload.lifecycleGeneration) throw new Error();
      attempt = { lojaId: payload.lojaId, generation: payload.lifecycleGeneration, nonce: state };
    } catch { res.status(400).json({ message: "Autorização inválida ou expirada. Solicite conferência administrativa." }); return; }
    try {
      // Consumo durável antes do código remoto: repetição e resultado incerto não abrem outro envio.
      await repository.consumirAutorizacao(config.storeId, attempt);
      if (error !== undefined || typeof code !== "string" || !code.trim() || code.length > 2048) {
        throw new NuvemshopError(400, "A autorização não foi concluída. Solicite conferência administrativa.");
      }
      const loja = await client.connect(code);
      await repository.salvarLoja(loja, attempt);
      res.json({ message: "Loja conectada. Entre no PORTERO com a conta interna desta instalação.",
        loja: { nuvemshopStoreId: loja.nuvemshopStoreId, nomeLoja: loja.nomeLoja } });
    } catch (failure) {
      res.status(failure instanceof NuvemshopError ? failure.status : 503)
        .json({ message: failure instanceof NuvemshopError ? failure.message : "Conexão não confirmada. Solicite conferência administrativa." });
    }
  });
  return router;
}
