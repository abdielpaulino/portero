import { createApp } from "./app.js";
import { authRepository } from "./auth/repository.js";
import { createNuvemshopClient } from "./nuvemshop/oauth.js";
import { createNuvemshopRepository } from "./nuvemshop/repository.js";
import { inventoryRepository } from "./inventory/repository.js";
import { createProductsClient } from "./nuvemshop/products.js";
import { createStockClient } from "./nuvemshop/stock.js";
import { createStockRepository } from "./stock/repository.js";
import { stockHistoryRepository } from "./inventory/history-repository.js";
import { readRuntime } from "./runtime.js";
import { createWebhookRepository } from "./nuvemshop/webhook-repository.js";
import { createPrivacyReporter } from "./nuvemshop/privacy-report.js";
import { pool, webhookPool } from "./db/client.js";

const runtime = readRuntime(process.env);
const config = runtime.nuvemshop;
const integration = runtime.integration;
const nuvemshopRepository = createNuvemshopRepository(pool);
const stock = { storeId: integration.storeId, enabled: runtime.stockEnabled,
  client: createStockClient(integration.userAgent), repository: createStockRepository(pool) };
const app = createApp({
  repository: authRepository, jwtSecret: process.env.JWT_SECRET ?? "",
  secureCookies: runtime.production, requireOrigin: runtime.production,
  webOrigin: runtime.webOrigin, apiOrigin: runtime.apiOrigin,
  webhooks: runtime.webhooks ? { ...runtime.webhooks,
    repository: createWebhookRepository(webhookPool), reporter: createPrivacyReporter(process.env) } : undefined,
  verifyInstallation: () => nuvemshopRepository.verificarInstalacao(integration.storeId),
  history: stockHistoryRepository,
  stock,
  inventory: { repository: inventoryRepository, client: createProductsClient(integration.userAgent) },
  nuvemshop: config ? { config, client: createNuvemshopClient(config), repository: nuvemshopRepository } : undefined,
});
export default app;
