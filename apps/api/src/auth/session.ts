import type { Request, RequestHandler } from "express";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "portero_session";
export const SELECTION_COOKIE = "portero_store_selection";
export const SESSION_SECONDS = 60 * 60;
export const SELECTION_SECONDS = 5 * 60;

export type AuthContext = { usuarioId: number; lojaId: number };
export type SelectionUser = { id: number; nome: string; email: string };

export function readCookie(req: Request, name: string) {
  const cookie = req.headers.cookie?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function createSessionService(secret: string) {
  const key = new TextEncoder().encode(secret);
  if (key.length < 32) {
    throw new Error("JWT_SECRET deve ter pelo menos 32 bytes e existir somente no backend.");
  }

  async function issue({ usuarioId, lojaId }: AuthContext) {
    return new SignJWT({ lojaId, purpose: "session" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(String(usuarioId))
      .setIssuer("portero")
      .setAudience("portero-api")
      .setIssuedAt()
      .setExpirationTime(`${SESSION_SECONDS}s`)
      .sign(key);
  }

  async function verify(token: string): Promise<AuthContext> {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "portero",
      audience: "portero-api",
      requiredClaims: ["sub", "iat", "exp", "lojaId", "purpose"],
    });
    const usuarioId = Number(payload.sub);
    const lojaId = payload.lojaId;
    if (payload.purpose !== "session" || !Number.isSafeInteger(usuarioId) || usuarioId <= 0
      || typeof lojaId !== "number" || !Number.isSafeInteger(lojaId) || lojaId <= 0) {
      throw new Error("Sessão inválida.");
    }
    return { usuarioId, lojaId };
  }

  async function issueSelection(usuario: SelectionUser) {
    return new SignJWT({ purpose: "store-selection", nome: usuario.nome, email: usuario.email })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(String(usuario.id))
      .setIssuer("portero")
      .setAudience("portero-store-selection")
      .setIssuedAt()
      .setExpirationTime(`${SELECTION_SECONDS}s`)
      .sign(key);
  }

  async function verifySelection(token: string): Promise<SelectionUser> {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "portero",
      audience: "portero-store-selection",
      maxTokenAge: `${SELECTION_SECONDS}s`,
      requiredClaims: ["sub", "iat", "exp", "purpose", "nome", "email"],
    });
    const id = Number(payload.sub);
    if (payload.purpose !== "store-selection" || !Number.isSafeInteger(id) || id <= 0
      || typeof payload.nome !== "string" || typeof payload.email !== "string"
      || payload.lojaId !== undefined) {
      throw new Error("Seleção inválida.");
    }
    return { id, nome: payload.nome, email: payload.email };
  }

  const authenticate: RequestHandler = async (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      res.status(401).json({ message: "Sessão inválida ou expirada." });
      return;
    }
    try {
      res.locals.auth = await verify(token);
      next();
    } catch {
      res.status(401).json({ message: "Sessão inválida ou expirada." });
    }
  };

  return { issue, verify, issueSelection, verifySelection, authenticate };
}
