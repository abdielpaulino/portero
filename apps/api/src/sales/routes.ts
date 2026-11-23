import { Router } from "express";
import { createSessionService, type AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { createProductsClient } from "../nuvemshop/products.js";
import type { StockOptions } from "../stock/routes.js";
import { object, presentSale, uuid, validateFinancial, validateSale } from "./domain.js";
import type { SalesRepository } from "./repository.js";
import { createExternalSale, executeSaleItem } from "./service.js";

export type SalesOptions = { repository: SalesRepository; products: ReturnType<typeof createProductsClient>; stock: StockOptions };
export function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}
export function createSalesRouter(secret: string, options?: SalesOptions) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(createSessionService(secret).authenticate);
  router.use((_req, res, next) => {
    if (!options) { res.status(503).json({ message: "Vendas externas ainda não foram ativadas. O fluxo de estoque existente continua disponível." }); return; }
    next();
  });
  const route = (work: (req: import("express").Request, auth: AuthContext) => Promise<unknown>) => async (req: import("express").Request, res: import("express").Response) => {
    try {
      const value = await work(req, res.locals.auth as AuthContext);
      if (value && typeof value === "object" && "httpStatus" in value && "body" in value) res.status(Number(value.httpStatus)).json(value.body);
      else res.json(value);
    } catch (error) {
      res.status(error instanceof NuvemshopError ? error.status : 503).json({ message: error instanceof NuvemshopError ? error.message
        : "Registro comercial não confirmado. Recupere a mesma requisição ou venda antes de continuar; confira a migração e as permissões." });
    }
  };
  const id = (value: unknown) => {
    if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2_147_483_647) throw new NuvemshopError(400, "ID inválido.");
    return Number(value);
  };
  router.use((req, res, next) => {
    if (req.method !== "GET" && Object.keys(req.query).length) { res.status(400).json({ message: "Parâmetros não permitidos." }); return; }
    next();
  });
  router.get("/summary", route(async (req, auth) => {
    if (Object.keys(req.query).some(key => key !== "periodo") || (req.query.periodo !== undefined && typeof req.query.periodo !== "string")) throw new NuvemshopError(400, "Período inválido.");
    return options!.repository.summary(auth, req.query.periodo as string ?? currentMonth());
  }));
  router.get("/by-request/:key", route(async (req, auth) => {
    if (Object.keys(req.query).length) throw new NuvemshopError(400, "Parâmetros não permitidos.");
    const sale = await options!.repository.findRequest(auth, uuid(req.params.key));
    if (!sale) throw new NuvemshopError(404, "Registro ainda não encontrado. Não gere outra chave para a mesma venda.");
    return presentSale(sale);
  }));
  router.get("/", route(async (req, auth) => {
    const page = req.query.page ?? "1";
    if (Object.keys(req.query).some(key => key !== "page") || typeof page !== "string" || !/^[1-9]\d{0,5}$/.test(page)) throw new NuvemshopError(400, "Página inválida.");
    const result = await options!.repository.list(auth, Number(page));
    return { ...result, items: result.items.map(presentSale), page: Number(page) };
  }));
  router.post("/", route(async (req, auth) => createExternalSale(options!.repository, options!.products, auth, uuid(req.get("Idempotency-Key")), validateSale(req.body))));
  router.get("/:id", route(async (req, auth) => {
    if (Object.keys(req.query).length) throw new NuvemshopError(400, "Parâmetros não permitidos.");
    return presentSale(await options!.repository.get(auth, id(req.params.id)));
  }));
  router.post("/:id/items/:itemId/execute", route(async (req, auth) => {
    object(req.body, []);
    return executeSaleItem(options!.repository, options!.stock, auth, id(req.params.id), id(req.params.itemId));
  }));
  router.post("/:id/financial-events", route(async (req, auth) => presentSale(await options!.repository.financial(auth, id(req.params.id), uuid(req.get("Idempotency-Key")), validateFinancial(req.body)))));
  router.post("/:id/cancel", route(async (req, auth) => { object(req.body, []); return presentSale(await options!.repository.cancel(auth, id(req.params.id))); }));
  return router;
}
