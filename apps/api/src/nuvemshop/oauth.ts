export type NuvemshopConfig = {
  clientId: string;
  clientSecret: string;
  storeId: string;
  userAgent: string;
  apiOrigin: string;
  installationId: string;
  adminToken: string;
};

export type LojaConectada = {
  nuvemshopStoreId: string;
  accessToken: string;
  scope: string;
  nomeLoja: string;
};

export class NuvemshopError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function readNuvemshopConfig(env: NodeJS.ProcessEnv): NuvemshopConfig | undefined {
  const values = [env.NUVEMSHOP_CLIENT_ID, env.NUVEMSHOP_CLIENT_SECRET,
    env.NUVEMSHOP_STORE_ID, env.NUVEMSHOP_USER_AGENT];
  if (values.every((value) => !value?.trim())) return undefined;
  const [clientId, clientSecret, storeId, userAgent] = values.map((value) => value?.trim() ?? "");
  const apiOrigin = env.API_PUBLIC_URL?.trim() ?? "http://localhost:3001";
  const installationId = env.PORTERO_INSTALLATION_ID?.trim() ?? "";
  const adminToken = env.INSTALLATION_ADMIN_TOKEN ?? "";
  if (!/^[1-9]\d*$/.test(clientId) || !clientSecret || (storeId !== "" && !/^[1-9]\d*$/.test(storeId))
    || !userAgent || /[\r\n]/.test(userAgent)) {
    throw new Error("Configure as credenciais NUVEMSHOP e NUVEMSHOP_STORE_ID numérico, ou vazio somente para descoberta administrativa.");
  }
  if (env.NUVEMSHOP_DEMO_STORE_ID) throw new Error("Substitua NUVEMSHOP_DEMO_STORE_ID por NUVEMSHOP_STORE_ID somente após conferir o banco desta instalação.");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(installationId) || Buffer.byteLength(adminToken) < 32 || /[\r\n]/.test(adminToken)) {
    throw new Error("Configure PORTERO_INSTALLATION_ID e INSTALLATION_ADMIN_TOKEN exclusivo com pelo menos 32 bytes.");
  }
  validateOrigin(apiOrigin, env.NODE_ENV === "production");
  return { clientId, clientSecret, storeId, userAgent, apiOrigin, installationId, adminToken };
}

export function validateOrigin(value: string, production: boolean) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Informe uma origem válida, sem caminho ou barra final."); }
  if (url.origin !== value || url.username || url.password || (url.protocol !== "https:"
    && (production || url.protocol !== "http:" || !["localhost", "127.0.0.1", "192.168.3.7"].includes(url.hostname)))) {
    throw new Error("Use HTTPS em produção e uma origem sem caminho ou barra final.");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storeId(value: unknown): string | undefined {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

export function createNuvemshopClient(config: NuvemshopConfig, fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
  async function requestJson(url: string, init: RequestInit): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetcher(url, {
        ...init, signal, redirect: "error",
        headers: { Accept: "application/json", "User-Agent": config.userAgent, ...init.headers },
      });
      if (!response.ok) throw new NuvemshopError(502, "A Nuvemshop recusou a solicitação. Solicite conferência administrativa.");
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw new NuvemshopError(504, "A Nuvemshop demorou para responder. Solicite conferência administrativa.");
      if (error instanceof NuvemshopError) throw error;
      // Erros externos podem conter o código de autorização ou credenciais.
      throw new NuvemshopError(502, "Não foi possível obter uma resposta válida da Nuvemshop.");
    }
  }

  async function exchangeCode(code: string) {
    const token = await requestJson("https://www.nuvemshop.com.br/apps/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret,
        grant_type: "authorization_code", code }),
    });
    const id = record(token) ? storeId(token.user_id) : undefined;
    if (!record(token) || !id || typeof token.access_token !== "string"
      || !/^[\x21-\x7e]{1,4096}$/.test(token.access_token) || token.token_type !== "bearer"
      || typeof token.scope !== "string" || token.scope.length > 4096
      || !/^[a-z_]+(?:\s*,\s*[a-z_]+)*$/.test(token.scope)) {
      throw new NuvemshopError(502, "A Nuvemshop retornou credenciais inválidas.");
    }
    return { id, accessToken: token.access_token, scope: token.scope };
  }

  async function discoverStoreId(code: string): Promise<string> {
    if (config.storeId) {
      throw new NuvemshopError(409, "A loja já está configurada. Use a rota de autorização.");
    }
    // O token desta descoberta é descartado sem consultar a API ou persistir credenciais.
    const token = await exchangeCode(code);
    return token.id;
  }

  async function connect(code: string): Promise<LojaConectada> {
    if (!config.storeId) {
      throw new NuvemshopError(409, "Configure NUVEMSHOP_STORE_ID antes de conectar a loja.");
    }
    const token = await exchangeCode(code);
    const id = token.id;
    if (id !== config.storeId) {
      throw new NuvemshopError(403, "A autorização não corresponde à loja configurada para esta instalação.");
    }

    const store = await requestJson(`https://api.nuvemshop.com.br/2025-03/${id}/store`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!record(store) || storeId(store.id) !== id || !record(store.name)) {
      throw new NuvemshopError(502, "A Nuvemshop retornou dados inválidos da loja.");
    }
    const language = typeof store.main_language === "string" ? store.main_language : "pt";
    const names = [store.name[language], store.name.pt, ...Object.values(store.name)];
    const name = names.find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof name !== "string" || name.length > 1000) {
      throw new NuvemshopError(502, "A Nuvemshop retornou um nome inválido para a loja.");
    }
    return { nuvemshopStoreId: id, accessToken: token.accessToken, scope: token.scope, nomeLoja: name.trim() };
  }

  return { connect, discoverStoreId };
}
