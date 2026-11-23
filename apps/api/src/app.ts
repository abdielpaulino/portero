import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createAuthRouter } from "./auth/routes.js";
import type { AuthRepository } from "./auth/repository.js";
import { createNuvemshopRouter, type NuvemshopOptions } from "./nuvemshop/routes.js";
import { createInventoryRouter, type InventoryOptions } from "./inventory/routes.js";
import { createStockRouter, type StockOptions } from "./stock/routes.js";
import { createStockHistoryRouter, type StockHistoryRepository } from "./inventory/history.js";
import { NuvemshopError } from "./nuvemshop/oauth.js";
import { createNuvemshopWebhookRouter, type WebhookOptions } from "./nuvemshop/webhooks.js";
import { createSalesRouter, type SalesOptions } from "./sales/routes.js";
import { createOrdersRouter, type OrdersOptions } from "./sales/orders-routes.js";
import { createInvitationRouter, type InvitationRepository } from "./auth/invitations.js";
import { createConferenceRouter, type ConferenceRepository } from "./operations/conferences.js";
import { createSettingsRouter, createMonitorRouter, type SettingsOptions } from "./operations/settings.js";

type AppOptions = {
  repository: AuthRepository;
  jwtSecret: string;
  secureCookies?: boolean;
  webOrigin?: string;
  environment?: string;
  nuvemshop?: NuvemshopOptions;
  inventory?: InventoryOptions;
  stock?: StockOptions;
  history?: StockHistoryRepository;
  apiOrigin?: string;
  requireOrigin?: boolean;
  verifyInstallation?: () => Promise<void>;
  webhooks?: WebhookOptions;
  sales?: SalesOptions;
  orders?: OrdersOptions;
  invitations?: InvitationRepository;
  conferences?: ConferenceRepository;
  settings?: SettingsOptions;
  cronSecret?: string;
};

export function createApp({ repository, jwtSecret, secureCookies = false, webOrigin = "http://localhost:3000", nuvemshop, inventory, stock, history,
  apiOrigin = "http://localhost:3001", requireOrigin = false, verifyInstallation, webhooks, sales, orders, invitations, conferences, settings, cronSecret }: AppOptions) {
  const app = express();
  if (webhooks) app.use("/webhooks/nuvemshop", createNuvemshopWebhookRouter(webhooks));
  app.use("/internal", createMonitorRouter(cronSecret, settings));
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use((req, res, next) => {
    const installationRoute = req.path.startsWith("/auth/nuvemshop/");
    const origin = req.get("Origin");
    const bearerAdmin = installationRoute && req.get("Authorization")?.startsWith("Bearer ");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)
      && ((origin && origin !== (installationRoute ? apiOrigin : webOrigin)) || (requireOrigin && !origin && !bearerAdmin))) {
      res.status(403).json({ message: "Origem da solicitação não permitida." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "8kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (nuvemshop) app.use("/auth/nuvemshop", createNuvemshopRouter(nuvemshop, jwtSecret, secureCookies));
  app.use(async (req, res, next) => {
    if (req.method === "POST" && /^\/auth\/logout\/?$/.test(req.path)) { next(); return; }
    try { await verifyInstallation?.(); next(); }
    catch (error) {
      res.status(error instanceof NuvemshopError ? error.status : 503).json({ message: "Instalação indisponível. Solicite conferência administrativa do controle e da loja." });
    }
  });

  app.use("/auth/invitations", createInvitationRouter(invitations));
  app.use("/auth", createAuthRouter(repository, jwtSecret, secureCookies, stock?.enabled, sales || orders ? { externas: !!sales, online: !!orders } : undefined,
    settings || conferences ? { configuracoes: !!settings, conferencias: !!conferences } : undefined));
  app.use("/settings", createSettingsRouter(jwtSecret, settings));
  app.use("/inventory/stock-decreases/:id/reviews", createConferenceRouter(jwtSecret, conferences));
  app.use("/sales/external", createSalesRouter(jwtSecret, sales));
  app.use("/sales/online-orders", createOrdersRouter(jwtSecret, orders));
  app.use("/inventory", createInventoryRouter(jwtSecret, inventory));
  app.use("/inventory/stock-decreases", createStockHistoryRouter(repository, jwtSecret, history));
  app.use("/inventory/stock-decreases", createStockRouter(jwtSecret, stock));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error.status === 400 || error.status === 413 ? error.status : 500;
    res.status(status).json({
      message: status === 500 ? "Não foi possível concluir a solicitação. Tente novamente." : "Requisição inválida.",
    });
  };
  app.use(handleError);

  return app;
}
