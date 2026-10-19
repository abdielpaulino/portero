import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createAuthRouter } from "./auth/routes.js";
import type { AuthRepository } from "./auth/repository.js";

type AppOptions = {
  repository: AuthRepository;
  jwtSecret: string;
  secureCookies?: boolean;
  webOrigin?: string;
};

export function createApp({ repository, jwtSecret, secureCookies = false, webOrigin = "http://localhost:3000" }: AppOptions) {
  const app = express();
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json({ limit: "8kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(repository, jwtSecret, secureCookies));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error.status === 400 || error.status === 413 ? error.status : 500;
    res.status(status).json({
      message: status === 500 ? "Não foi possível concluir a solicitação. Tente novamente." : "Requisição inválida.",
    });
  };
  app.use(handleError);

  return app;
}
