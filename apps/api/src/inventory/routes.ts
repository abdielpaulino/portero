import { Router } from "express";
import { createSessionService, type AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { createProductsClient } from "../nuvemshop/products.js";
import type { InventoryRepository } from "./repository.js";

export type InventoryOptions = {
  repository: InventoryRepository;
  client: ReturnType<typeof createProductsClient>;
};

export function createInventoryRouter(jwtSecret: string, options?: InventoryOptions) {
  const router = Router();
  const sessions = createSessionService(jwtSecret);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", sessions.authenticate, async (req, res, next) => {
    const page = req.query.page ?? "1";
    if (Object.keys(req.query).some((key) => key !== "page") || typeof page !== "string"
      || !/^[1-9]\d{0,5}$/.test(page)) {
      res.status(400).json({ message: "Página de inventário inválida." });
      return;
    }
    if (!options) {
      res.status(503).json({ message: "A consulta à Nuvemshop não está configurada." });
      return;
    }
    try {
      const auth = res.locals.auth as AuthContext;
      const stores = await options.repository.listarLojas(auth.usuarioId);
      if (stores.length !== 1 || stores[0].id !== auth.lojaId) {
        res.status(403).json({ message: "Loja indisponível para esta conta." });
        return;
      }
      res.json(await options.client.list(stores[0], Number(page)));
    } catch (error) {
      if (error instanceof NuvemshopError) res.status(error.status).json({ message: error.message });
      else next(new Error("Não foi possível consultar a loja conectada."));
    }
  });
  router.get("/products/:id", sessions.authenticate, async (req, res, next) => {
    if (!/^[1-9]\d{0,19}$/.test(req.params.id) || Object.keys(req.query).length) {
      res.status(400).json({ message: "Informe somente o ID do produto." }); return;
    }
    if (!options) { res.status(503).json({ message: "A consulta à Nuvemshop não está configurada." }); return; }
    try {
      const auth = res.locals.auth as AuthContext;
      const stores = await options.repository.listarLojas(auth.usuarioId);
      if (stores.length !== 1 || stores[0].id !== auth.lojaId) {
        res.status(403).json({ message: "Loja indisponível para esta conta." }); return;
      }
      res.json(await options.client.get(stores[0], req.params.id));
    } catch (error) {
      if (error instanceof NuvemshopError) res.status(error.status).json({ message: error.message });
      else next(new Error("Não foi possível consultar o produto da loja conectada."));
    }
  });
  return router;
}
