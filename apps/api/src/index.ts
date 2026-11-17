import "dotenv/config";
import { createApp } from "./app.js";
import { authRepository } from "./auth/repository.js";
import { createNuvemshopClient, readNuvemshopConfig } from "./nuvemshop/oauth.js";
import { nuvemshopRepository } from "./nuvemshop/repository.js";

const nuvemshopConfig = readNuvemshopConfig(process.env);

const app = createApp({
  repository: authRepository,
  jwtSecret: process.env.JWT_SECRET ?? "",
  secureCookies: process.env.NODE_ENV === "production",
  webOrigin: process.env.WEB_ORIGIN,
  environment: process.env.NODE_ENV,
  nuvemshop: nuvemshopConfig ? {
    config: nuvemshopConfig,
    client: createNuvemshopClient(nuvemshopConfig),
    repository: nuvemshopRepository,
  } : undefined,
});

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
