import { readNuvemshopConfig, validateOrigin } from "./nuvemshop/oauth.js";

export function readRuntime(env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === "production";
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3000";
  const apiOrigin = env.API_PUBLIC_URL ?? "http://localhost:3001";
  validateOrigin(webOrigin, production);
  validateOrigin(apiOrigin, production);
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") throw new Error("Não use a instalação real em deploys Preview ou Development.");
  if (env.VERCEL_ENV === "production" && !production) throw new Error("A API publicada exige NODE_ENV=production.");
  if (env.STOCK_DECREASES_ENABLED && !["true", "false"].includes(env.STOCK_DECREASES_ENABLED)) throw new Error("STOCK_DECREASES_ENABLED deve ser true ou false.");
  if (production && env.NUVEMSHOP_DEMO_STORE_ID) throw new Error("Use NUVEMSHOP_STORE_ID confirmado para produção.");
  const storeId = env.NUVEMSHOP_STORE_ID?.trim() || (!production ? env.NUVEMSHOP_DEMO_STORE_ID?.trim() : "") || "";
  const userAgent = env.NUVEMSHOP_USER_AGENT?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(storeId) || !userAgent || /[\r\n]/.test(userAgent)) throw new Error("Configure o ID da loja e NUVEMSHOP_USER_AGENT para consultar a instalação existente.");
  // A demo conectada não precisa de segredo administrativo ou de outro OAuth.
  const oauthReady = [env.NUVEMSHOP_CLIENT_ID, env.NUVEMSHOP_CLIENT_SECRET, env.PORTERO_INSTALLATION_ID, env.INSTALLATION_ADMIN_TOKEN].every(value => value?.trim());
  const oauthEnv: NodeJS.ProcessEnv = { ...env, NUVEMSHOP_STORE_ID: storeId };
  delete oauthEnv.NUVEMSHOP_DEMO_STORE_ID;
  const nuvemshop = oauthReady ? readNuvemshopConfig(oauthEnv) : undefined;
  const clientId = env.NUVEMSHOP_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.NUVEMSHOP_CLIENT_SECRET?.trim() ?? "";
  const webhooks = /^[1-9]\d*$/.test(clientId) && clientSecret ? { clientId, clientSecret, storeId } : undefined;
  if (production && !webhooks) throw new Error("Configure as credenciais do aplicativo para validar webhooks em produção.");
  return { production, webOrigin, apiOrigin, nuvemshop, integration: { storeId, userAgent }, webhooks,
    stockEnabled: env.STOCK_DECREASES_ENABLED === "true" };
}
