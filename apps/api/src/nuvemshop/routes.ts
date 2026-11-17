import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type CookieOptions, type RequestHandler } from "express";
import { jwtVerify, SignJWT } from "jose";
import { readCookie } from "../auth/session.js";
import { NuvemshopError, type NuvemshopConfig, type createNuvemshopClient } from "./oauth.js";
import type { NuvemshopRepository } from "./repository.js";

export const OAUTH_COOKIE = "portero_nuvemshop_oauth";
export const OAUTH_SECONDS = 5 * 60;

export type NuvemshopOptions = {
  config: NuvemshopConfig;
  client: ReturnType<typeof createNuvemshopClient>;
  repository: NuvemshopRepository;
};

export function createNuvemshopRouter({ config, client, repository }: NuvemshopOptions, jwtSecret: string) {
  const router = Router();
  const key = new TextEncoder().encode(jwtSecret);
  const cookieOptions: CookieOptions = {
    httpOnly: true, sameSite: "lax", secure: false, path: "/auth/nuvemshop",
  };

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  function authorize(mode: "setup" | "connect"): RequestHandler {
    return async (_req, res, next) => {
      if (mode === "setup" && config.demoStoreId) {
        res.status(409).json({ message: "A loja demo já está configurada. Use /auth/nuvemshop/authorize." });
        return;
      }
      if (mode === "connect" && !config.demoStoreId) {
        res.status(409).json({ message: "Identifique a loja demo em /auth/nuvemshop/setup e configure NUVEMSHOP_DEMO_STORE_ID antes de conectar." });
        return;
      }
      try {
        const state = randomBytes(32).toString("hex");
        // A audience separada impede o uso dos JWTs do login interno neste fluxo.
        const cookie = await new SignJWT({ clientId: config.clientId, demoStoreId: config.demoStoreId, mode })
          .setProtectedHeader({ alg: "HS256", typ: "JWT" })
          .setSubject(state).setIssuer("portero").setAudience("portero-nuvemshop-oauth")
          .setIssuedAt().setExpirationTime(`${OAUTH_SECONDS}s`).sign(key);
        res.cookie(OAUTH_COOKIE, cookie, { ...cookieOptions, maxAge: OAUTH_SECONDS * 1000 });
        const url = new URL(`https://www.nuvemshop.com.br/apps/${config.clientId}/authorize`);
        url.searchParams.set("state", state);
        res.redirect(url.toString());
      } catch {
        next(new Error("Não foi possível iniciar a autorização da Nuvemshop."));
      }
    };
  }

  router.get("/setup", authorize("setup"));
  router.get("/authorize", authorize("connect"));

  router.get("/callback", async (req, res, next) => {
    res.clearCookie(OAUTH_COOKIE, cookieOptions);
    const { state, code, error } = req.query;
    let mode: "setup" | "connect";
    try {
      if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)) throw new Error();
      const { payload } = await jwtVerify(readCookie(req, OAUTH_COOKIE) ?? "", key, {
        algorithms: ["HS256"], issuer: "portero", audience: "portero-nuvemshop-oauth",
        maxTokenAge: `${OAUTH_SECONDS}s`, requiredClaims: ["sub", "iat", "exp", "clientId", "demoStoreId", "mode"],
      });
      if (typeof payload.sub !== "string" || !/^[a-f0-9]{64}$/.test(payload.sub)
        || !timingSafeEqual(Buffer.from(state), Buffer.from(payload.sub))
        || payload.clientId !== config.clientId || payload.demoStoreId !== config.demoStoreId
        || (payload.mode !== "setup" && payload.mode !== "connect")
        || (payload.mode === "setup") !== !config.demoStoreId) throw new Error();
      mode = payload.mode;
    } catch {
      res.status(400).json({ message: "Autorização inválida ou expirada. Inicie novamente neste navegador." });
      return;
    }

    if (error !== undefined) {
      res.status(400).json({ message: "A autorização não foi concluída na Nuvemshop. Inicie novamente." });
      return;
    }
    if (typeof code !== "string" || !code.trim() || code.length > 2048) {
      res.status(400).json({ message: "Código de autorização ausente ou inválido. Inicie novamente." });
      return;
    }

    try {
      if (mode === "setup") {
        const id = await client.discoverStoreId(code);
        res.json({ requiresConfiguration: true, nuvemshopStoreId: id,
          message: "ID candidato obtido. Confirme que a loja autorizada é a demo, preencha NUVEMSHOP_DEMO_STORE_ID no .env e reinicie a API. Depois inicie /auth/nuvemshop/authorize. Nenhuma credencial foi salva." });
        return;
      }
      const loja = await client.connect(code);
      await repository.salvarLoja(loja);
      res.json({ message: "Loja demo conectada. Entre no PORTERO com seu login interno.",
        loja: { nuvemshopStoreId: loja.nuvemshopStoreId, nomeLoja: loja.nomeLoja } });
    } catch (error) {
      if (error instanceof NuvemshopError) {
        res.status(error.status).json({ message: error.message });
      } else {
        next(new Error("Não foi possível salvar a conexão da loja demo."));
      }
    }
  });

  return router;
}
