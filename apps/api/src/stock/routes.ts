import { Router } from "express";
import { createSessionService, type AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { createStockClient } from "../nuvemshop/stock.js";
import { cancelStockDecrease, decreaseStock, inspectStockDecrease, registerStockDecrease, type StockRepository } from "./service.js";

export type StockOptions = { demoStoreId: string; repository: StockRepository; client: ReturnType<typeof createStockClient> };
export function createStockRouter(jwtSecret: string, options?: StockOptions) {
  const router = Router();
  const sessions = createSessionService(jwtSecret);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(sessions.authenticate);
  router.use((_req, res, next) => {
    if (!options || !/^[1-9]\d*$/.test(options.demoStoreId)) { res.status(503).json({ message: "Configure a loja demo para operar o estoque." }); return; }
    next();
  });
  router.post("/", async (req, res, next) => {
    const body: unknown = req.body;
    if (Object.keys(req.query).length || req.get("Idempotency-Key") || typeof body !== "object" || body === null || Array.isArray(body)
      || Object.keys(body).some(key => !["produtoId", "varianteId", "quantidade"].includes(key))) {
      res.status(400).json({ message: "Informe somente produtoId, varianteId e quantidade. A criação é apenas local." }); return;
    }
    const { produtoId, varianteId, quantidade } = body as Record<string, unknown>;
    if (typeof produtoId !== "string" || !/^[1-9]\d{0,19}$/.test(produtoId)
      || typeof varianteId !== "string" || !/^[1-9]\d{0,19}$/.test(varianteId) || !Number.isSafeInteger(Number(varianteId))
      || typeof quantidade !== "number" || !Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 2_147_483_647) {
      res.status(400).json({ message: "Informe IDs válidos e quantidade inteira positiva." }); return;
    }
    try {
      const result = await registerStockDecrease(options!.repository, options!.demoStoreId, res.locals.auth as AuthContext, { produtoId, varianteId, quantidade });
      res.status(result.httpStatus).json(result.body);
    } catch (error) { handle(error, res, next); }
  });
  router.all(["/:id", "/:id/execute", "/:id/cancel"], (req, res, next) => {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id) || Number(req.params.id) > 2_147_483_647
      || Object.keys(req.query).length || req.get("Idempotency-Key")
      || (req.body !== undefined && (typeof req.body !== "object" || req.body === null || Array.isArray(req.body) || Object.keys(req.body).length))) {
      res.status(400).json({ message: "Informe somente o ID da operação, sem substituir seus dados." }); return;
    }
    next();
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const result = await inspectStockDecrease(options!.repository, options!.demoStoreId, res.locals.auth as AuthContext, Number(req.params.id));
      res.status(result.httpStatus).json(result.body);
    } catch (error) { handle(error, res, next); }
  });
  for (const action of ["execute", "cancel"] as const) router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      const auth = res.locals.auth as AuthContext;
      const id = Number(req.params.id);
      const result = action === "execute"
        ? await decreaseStock(options!.repository, options!.client, options!.demoStoreId, auth, id)
        : await cancelStockDecrease(options!.repository, options!.demoStoreId, auth, id);
      res.status(result.httpStatus).json(result.body);
    } catch (error) { handle(error, res, next); }
  });
  return router;
}
function handle(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof NuvemshopError) res.status(error.status).json({ message: error.message });
  else next(new Error("Operação indisponível. Consulte o histórico antes de continuar."));
}
