export type NuvemshopConfig = {
  clientId: string;
  clientSecret: string;
  demoStoreId: string;
  userAgent: string;
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
  if (env.NODE_ENV !== "development") return undefined;
  const values = [env.NUVEMSHOP_CLIENT_ID, env.NUVEMSHOP_CLIENT_SECRET,
    env.NUVEMSHOP_DEMO_STORE_ID, env.NUVEMSHOP_USER_AGENT];
  if (values.every((value) => !value?.trim())) return undefined;
  const [clientId, clientSecret, demoStoreId, userAgent] = values.map((value) => value?.trim() ?? "");
  if (!/^[1-9]\d*$/.test(clientId) || !clientSecret || (demoStoreId !== "" && !/^[1-9]\d*$/.test(demoStoreId))
    || !userAgent || /[\r\n]/.test(userAgent)) {
    throw new Error("Configure NUVEMSHOP_CLIENT_ID, NUVEMSHOP_CLIENT_SECRET e NUVEMSHOP_USER_AGENT no backend. NUVEMSHOP_DEMO_STORE_ID deve ser vazio ou um ID numérico válido.");
  }
  return { clientId, clientSecret, demoStoreId, userAgent };
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
      if (!response.ok) throw new NuvemshopError(502, "A Nuvemshop recusou a solicitação. Inicie a autorização novamente.");
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw new NuvemshopError(504, "A Nuvemshop demorou para responder. Inicie a autorização novamente.");
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
    if (config.demoStoreId) {
      throw new NuvemshopError(409, "A loja demo já está configurada. Use a rota de autorização.");
    }
    // O token desta descoberta é descartado sem consultar a API ou persistir credenciais.
    const token = await exchangeCode(code);
    return token.id;
  }

  async function connect(code: string): Promise<LojaConectada> {
    if (!config.demoStoreId) {
      throw new NuvemshopError(409, "Configure NUVEMSHOP_DEMO_STORE_ID antes de conectar a loja.");
    }
    const token = await exchangeCode(code);
    const id = token.id;
    if (id !== config.demoStoreId) {
      throw new NuvemshopError(403, "Esta integração de desenvolvimento aceita somente a loja demo configurada.");
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
