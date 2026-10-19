import { randomBytes } from "node:crypto";
import { compare, hashSync, truncates } from "bcryptjs";
import { Router, type CookieOptions, type Response } from "express";
import type { AuthRepository, LojaLogin, UsuarioLogin } from "./repository.js";
import {
  createSessionService, readCookie, SELECTION_COOKIE, SELECTION_SECONDS,
  SESSION_COOKIE, SESSION_SECONDS, type AuthContext,
} from "./session.js";

export function createAuthRouter(repository: AuthRepository, jwtSecret: string, secureCookies: boolean) {
  const router = Router();
  const sessions = createSessionService(jwtSecret);
  const dummyHash = hashSync(randomBytes(32).toString("hex"), 10);
  const cookieOptions: CookieOptions = {
    httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/",
  };

  function clearSelection(res: Response) {
    res.clearCookie(SELECTION_COOKIE, cookieOptions);
  }

  async function completeLogin(res: Response, usuario: Omit<UsuarioLogin, "senhaHash">, loja: LojaLogin) {
    const token = await sessions.issue({ usuarioId: usuario.id, lojaId: loja.id });
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
    res.json({ requiresStoreSelection: false, usuario, loja });
  }

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/login", async (req, res, next) => {
    try {
      clearSelection(res);
      res.clearCookie(SESSION_COOKIE, cookieOptions);
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || email.trim().length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        || typeof password !== "string" || password.length === 0 || truncates(password)) {
        res.status(400).json({ message: "Informe um e-mail válido e uma senha de até 72 bytes." });
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
      if (lojas.length === 0) {
        res.status(403).json({ message: "Sua conta não possui lojas disponíveis." });
        return;
      }

      const usuarioPublico = { id: usuario.id, nome: usuario.nome, email: usuario.email };
      if (lojas.length === 1) {
        await completeLogin(res, usuarioPublico, lojas[0]);
        return;
      }

      const token = await sessions.issueSelection(usuarioPublico);
      res.cookie(SELECTION_COOKIE, token, { ...cookieOptions, maxAge: SELECTION_SECONDS * 1000 });
      res.json({ requiresStoreSelection: true, lojas });
    } catch (error) {
      next(error);
    }
  });

  router.post("/select-store", async (req, res, next) => {
    try {
      let usuario;
      try {
        usuario = await sessions.verifySelection(readCookie(req, SELECTION_COOKIE) ?? "");
      } catch {
        clearSelection(res);
        res.status(401).json({ message: "Seleção inválida ou expirada. Entre novamente." });
        return;
      }

      const lojaId = req.body?.lojaId;
      if (!Number.isSafeInteger(lojaId) || lojaId <= 0) {
        res.status(400).json({ message: "Selecione uma loja válida." });
        return;
      }
      const lojas = await repository.listarLojas(usuario.id);
      const loja = lojas.find((item) => item.id === lojaId);
      if (!loja) {
        res.status(403).json({ message: "Loja indisponível para esta conta." });
        return;
      }

      clearSelection(res);
      await completeLogin(res, usuario, loja);
    } catch (error) {
      next(error);
    }
  });

  router.get("/session", sessions.authenticate, async (_req, res, next) => {
    try {
      const auth = res.locals.auth as AuthContext;
      const lojas = await repository.listarLojas(auth.usuarioId);
      const loja = lojas.find((item) => item.id === auth.lojaId);
      if (!loja) {
        res.clearCookie(SESSION_COOKIE, cookieOptions);
        res.status(403).json({ message: "Loja indisponível para esta conta." });
        return;
      }
      res.json({ usuarioId: auth.usuarioId, loja });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
