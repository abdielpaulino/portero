import { createHash } from "node:crypto";
import type { PrivacyRequest } from "./webhooks.js";

export function createPrivacyReporter(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch, timeoutMs = 2_000) {
  const token = env.RESEND_API_KEY?.trim();
  const from = env.PRIVACY_FROM_EMAIL?.trim();
  const to = env.PRIVACY_MERCHANT_EMAIL?.trim();
  if (!token && !from && !to) return undefined;
  const email = (value: string | undefined) => !!value && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
  if (!token || /[\r\n]/.test(token) || !email(from) || !email(to) || !env.PORTERO_INSTALLATION_ID) {
    throw new Error("Configure o canal de privacidade completo: remetente, lojista e credencial Resend.");
  }
  const installationId = env.PORTERO_INSTALLATION_ID;
  return async ({ storeId, requestId }: PrivacyRequest) => {
    if (!/^[1-9]\d{0,30}$/.test(storeId) || !/^[1-9]\d{0,30}$/.test(requestId)) throw new Error("Solicitação inválida.");
    const key = createHash("sha256").update(`${installationId}:${storeId}:${requestId}`).digest("hex");
    try {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `privacy/${key}` },
        body: JSON.stringify({ from, to: [to], subject: `PORTERO: solicitação de dados ${requestId}`,
          text: `Loja Nuvemshop: ${storeId}\nSolicitação: ${requestId}\n\nO PORTERO não armazena identificação de consumidores ou checkouts da Nuvemshop. Não há dados desse consumidor para exportar. A consulta de pedidos utiliza apenas dados comerciais mínimos, sem identificação de consumidores e sem persistência local. Os registros locais contêm contas internas, baixas e, quando habilitadas, vendas externas e movimentos financeiros sem identificação de consumidores.\n` }),
      });
      if (!response.ok) throw new Error();
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id.trim()) throw new Error();
    } catch { throw new Error("O provedor não confirmou o recebimento do relatório de privacidade."); }
  };
}
