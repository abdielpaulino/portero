import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createAuthRouter } from "./auth/routes.js";
import type { AuthRepository } from "./auth/repository.js";
import { createNuvemshopRouter, type NuvemshopOptions } from "./nuvemshop/routes.js";

type AppOptions = {
  repository: AuthRepository;
  jwtSecret: string;
  secureCookies?: boolean;
  webOrigin?: string;
  environment?: string;
  nuvemshop?: NuvemshopOptions;
};

export function createApp({ repository, jwtSecret, secureCookies = false, webOrigin = "http://localhost:3000", environment, nuvemshop }: AppOptions) {
  const app = express();
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("Origin") && req.get("Origin") !== webOrigin) {
      res.status(403).json({ message: "Origem da solicitação não permitida." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "8kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(repository, jwtSecret, secureCookies));
  if (environment === "development" && nuvemshop) {
    app.use("/auth/nuvemshop", createNuvemshopRouter(nuvemshop, jwtSecret));
  }

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error.status === 400 || error.status === 413 ? error.status : 500;
    res.status(status).json({
      message: status === 500 ? "Não foi possível concluir a solicitação. Tente novamente." : "Requisição inválida.",
    });
  };
  app.use(handleError);

  return app;
}
