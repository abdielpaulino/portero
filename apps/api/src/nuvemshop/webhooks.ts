import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import type { WebhookRepository } from "./webhook-repository.js";

export type PrivacyRequest = { storeId: string; requestId: string };
export type WebhookOptions = {
  clientSecret: string;
  clientId: string;
  storeId: string;
  repository: WebhookRepository;
  reporter?: (request: PrivacyRequest) => Promise<void>;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,30}$/.test(value)) return value;
}

export function createNuvemshopWebhookRouter(options: WebhookOptions) {
  const router = Router();
  // A assinatura cobre os bytes originais; JSON e validação de Origin ficam depois desta rota.
  router.use(express.raw({ type: "application/json", limit: "256kb", inflate: false }));
  const events = {
    "/uninstalled": "app/uninstalled", "/suspended": "app/suspended",
    "/store-redact": "app/store_redact", "/customer-redact": "customer/redact",
    "/customer-data-request": "customers/data_request",
  } as const;
  for (const [path, event] of Object.entries(events)) router.post(path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!options.storeId || !options.clientSecret) {
      res.status(503).json({ message: "Webhook indisponível nesta instalação." }); return;
    }
    const signature = req.get("x-linkedstore-hmac-sha256");
    if (!Buffer.isBuffer(req.body) || !signature || !/^[a-fA-F0-9]{64}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", options.clientSecret).update(req.body).digest())) {
      res.status(401).json({ message: "Assinatura inválida." }); return;
    }
    let payload: unknown;
    try { payload = JSON.parse(req.body.toString("utf8")); } catch {
      res.status(400).json({ message: "Corpo inválido." }); return;
    }
    if (!record(payload) || !id(payload.store_id)) { res.status(400).json({ message: "Evento inválido." }); return; }
    if (id(payload.store_id) !== options.storeId) { res.status(403).json({ message: "Loja diferente desta instalação." }); return; }
    // O HMAC não inclui a URL: não aceitar outro tipo de evento na rota de exclusão.
    if ((payload.event !== undefined && payload.event !== event)
      || (event === "app/store_redact" && Object.keys(payload).some(key => key !== "store_id"))) {
      res.status(400).json({ message: "Payload incompatível com o evento." }); return;
    }
    if ((event === "app/uninstalled" || event === "app/suspended")
      && (payload.event !== event || id(payload.id) !== options.clientId)) {
      res.status(400).json({ message: "Evento ou aplicativo inválido." }); return;
    }
    if ((event === "customer/redact" || event === "customers/data_request")
      && (!record(payload.customer) || !id(payload.customer.id))) {
      res.status(400).json({ message: "Consumidor inválido." }); return;
    }
    try {
      if (event === "customers/data_request") {
        if (!record(payload.data_request) || !id(payload.data_request.id)) {
          res.status(400).json({ message: "Solicitação inválida." }); return;
        }
        if (!options.reporter) throw new Error("Canal de privacidade não configurado");
        await options.reporter({ storeId: options.storeId, requestId: id(payload.data_request.id)! });
      } else if (event !== "customer/redact") {
        await options.repository.handle(options.storeId, event);
      }
      // Não importamos consumidores/pedidos. Contas internas não pertencem ao cadastro de consumidores.
      res.status(204).end();
    } catch {
      // Sem confirmação persistente ou entrega do relatório, permitir nova tentativa da plataforma.
      res.status(503).json({ message: "Evento não concluído. A entrega deve ser repetida." });
    }
  });
  return router;
}
