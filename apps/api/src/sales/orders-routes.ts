import { Router } from "express";
import { createSessionService, type AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { createOrdersClient } from "../nuvemshop/orders.js";
import type { SalesRepository } from "./repository.js";
import { currentMonth } from "./routes.js";

export type OrdersOptions = { repository: Pick<SalesRepository, "store" | "period">; client: ReturnType<typeof createOrdersClient> };
export function createOrdersRouter(secret: string, options?: OrdersOptions) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", createSessionService(secret).authenticate, async (req, res) => {
    try {
      if (!options) throw new NuvemshopError(503, "Consulta online ainda não ativada.");
      const page = req.query.page ?? "1", month = req.query.periodo ?? currentMonth();
      if (Object.keys(req.query).some(key => !["page", "periodo"].includes(key)) || typeof page !== "string" || !/^[1-9]\d{0,5}$/.test(page) || typeof month !== "string") throw new NuvemshopError(400, "Página ou período inválido.");
      const auth = res.locals.auth as AuthContext;
      const store = await options.repository.store(auth);
      const period = await options.repository.period(month);
      res.json(await options.client.list(store, period, Number(page)));
    } catch (error) {
      res.status(error instanceof NuvemshopError ? error.status : 503).json({ message: error instanceof NuvemshopError ? error.message : "Consulta de pedidos indisponível." });
    }
  });
  return router;
}
