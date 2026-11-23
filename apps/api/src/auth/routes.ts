import { randomBytes } from "node:crypto";
import { compare, hashSync, truncates } from "bcryptjs";
import { Router, type CookieOptions } from "express";
import type { AuthRepository } from "./repository.js";
import {
  createSessionService,
  SESSION_COOKIE, SESSION_SECONDS, type AuthContext,
} from "./session.js";

export function createAuthRouter(repository: AuthRepository, jwtSecret: string, secureCookies: boolean, stockEnabled = false, commercial?: { externas: boolean; online: boolean }, operational?: { configuracoes: boolean; conferencias: boolean }) {
  const router = Router();
  const sessions = createSessionService(jwtSecret);
  const dummyHash = hashSync(randomBytes(32).toString("hex"), 10);
  const cookieOptions: CookieOptions = {
    httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/",
  };

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/login", async (req, res, next) => {
    try {
      res.clearCookie("portero_store_selection", cookieOptions);
      res.clearCookie(SESSION_COOKIE, cookieOptions);
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || email.trim().length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        || typeof password !== "string" || password.length === 0 || truncates(password)) {
        res.status(400).json({ message: "Informe um e-mail e senha válidos." });
        return;
      }

      const usuarios = await repository.buscarUsuariosPorEmail(email.trim().toLowerCase());
      const usuario = usuarios.length === 1 ? usuarios[0] : undefined;
      const senhaValida = await compare(password, usuario?.senhaHash ?? dummyHash);
      if (!usuario || !senhaValida) {
        res.status(401).json({ message: "E-mail ou senha inválidos." });
        return;
      }

      const lojas = await repository.listarLojas(usuario.id);
      if (lojas.length !== 1) {
        res.status(403).json({ message: "Sua conta deve estar associada a uma única loja conectada." });
        return;
      }

      const usuarioPublico = { id: usuario.id, nome: usuario.nome, email: usuario.email };
      const loja = lojas[0];
      const token = await sessions.issue({ usuarioId: usuario.id, lojaId: loja.id });
      res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
      res.json({ requiresStoreSelection: false, usuario: usuarioPublico, loja });
    } catch (error) {
      next(error);
    }
  });

  router.get("/session", sessions.authenticate, async (_req, res, next) => {
    try {
      const auth = res.locals.auth as AuthContext;
      const lojas = await repository.listarLojas(auth.usuarioId);
      const loja = lojas[0];
      if (lojas.length !== 1 || loja.id !== auth.lojaId) {
        res.clearCookie(SESSION_COOKIE, cookieOptions);
        res.status(403).json({ message: "Loja indisponível para esta conta." });
        return;
      }
      res.json({ usuarioId: auth.usuarioId, loja, baixasHabilitadas: stockEnabled, ...(commercial ? { vendasExternasHabilitadas: commercial.externas, pedidosOnlineHabilitados: commercial.online } : {}),
        ...(operational ? { configuracoesHabilitadas: operational.configuracoes, conferenciasHabilitadas: operational.conferencias } : {}) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.clearCookie("portero_store_selection", cookieOptions);
    res.status(204).end();
  });

  return router;
}
