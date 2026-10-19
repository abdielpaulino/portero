import "dotenv/config";
import { createApp } from "./app.js";
import { authRepository } from "./auth/repository.js";

const app = createApp({
  repository: authRepository,
  jwtSecret: process.env.JWT_SECRET ?? "",
  secureCookies: process.env.NODE_ENV === "production",
  webOrigin: process.env.WEB_ORIGIN,
});

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
