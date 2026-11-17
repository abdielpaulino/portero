import { Router } from "express";
import type { AuthRepository } from "../auth/repository.js";
import { createSessionService, type AuthContext } from "../auth/session.js";

export type StockHistoryItem = {
  id: number;
  produtoId: string;
  varianteId: string;
  sku: string | null;
  quantidade: number;
  status: string;
  criadoEm: string;
  usuario: { id: number; nome: string; email: string };
};

export interface StockHistoryRepository {
  listar(lojaId: number, page: number, pageSize: number): Promise<StockHistoryItem[]>;
}

export const HISTORY_PAGE_SIZE = 50;

export function createStockHistoryRouter(authRepository: AuthRepository, jwtSecret: string,
  repository?: StockHistoryRepository) {
  const router = Router();
  const sessions = createSessionService(jwtSecret);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", sessions.authenticate, async (req, res, next) => {
    const page = req.query.page ?? "1";
    if (Object.keys(req.query).some((key) => key !== "page") || typeof page !== "string"
      || !/^[1-9]\d{0,5}$/.test(page)) {
      res.status(400).json({ message: "Página de histórico inválida." });
      return;
    }
    if (!repository) {
      res.status(503).json({ message: "A consulta do histórico não está configurada." });
      return;
    }
    try {
      const auth = res.locals.auth as AuthContext;
      const stores = await authRepository.listarLojas(auth.usuarioId);
      if (stores.length !== 1 || stores[0].id !== auth.lojaId) {
        res.status(403).json({ message: "Loja indisponível para esta conta." });
        return;
      }
      const rows = await repository.listar(auth.lojaId, Number(page), HISTORY_PAGE_SIZE);
      res.json({
        items: rows.slice(0, HISTORY_PAGE_SIZE),
        page: Number(page),
        hasMore: rows.length > HISTORY_PAGE_SIZE,
      });
    } catch {
      next(new Error("Não foi possível consultar o histórico de baixas."));
    }
  });
  return router;
}
