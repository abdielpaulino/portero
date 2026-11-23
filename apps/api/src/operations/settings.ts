import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { Router } from "express";
import type { Pool } from "pg";
import { createSessionService, type AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import { object } from "../sales/domain.js";
import { invitationEmail } from "../auth/invitations.js";
import { activeStore, operationTransaction } from "./database.js";
import type { InventoryItem, createProductsClient } from "../nuvemshop/products.js";

export type StoreSettings = { limiteRuptura: number; notificacoesAtivas: boolean; emailNotificacoes: string | null; atualizacaoAutomatica: boolean; intervaloSegundos: number; versao: number };
export const defaultSettings: StoreSettings = { limiteRuptura: 0, notificacoesAtivas: false, emailNotificacoes: null, atualizacaoAutomatica: true, intervaloSegundos: 60, versao: 0 };
const fields = `limite_ruptura AS "limiteRuptura",notificacoes_ativas AS "notificacoesAtivas",email_notificacoes AS "emailNotificacoes",
  atualizacao_automatica AS "atualizacaoAutomatica",intervalo_segundos AS "intervaloSegundos",versao,
  monitor_proxima_pagina AS "monitorProximaPagina",monitor_em AS "monitorEm",monitor_resultado AS "monitorResultado"`;
export function validateSettings(value: unknown): StoreSettings {
  const body = object(value, ["limiteRuptura", "notificacoesAtivas", "emailNotificacoes", "atualizacaoAutomatica", "intervaloSegundos", "versao"]);
  if (!Number.isInteger(body.limiteRuptura) || Number(body.limiteRuptura) < 0 || Number(body.limiteRuptura) > 2147483647
    || !Number.isInteger(body.intervaloSegundos) || Number(body.intervaloSegundos) < 60 || Number(body.intervaloSegundos) > 3600
    || !Number.isInteger(body.versao) || Number(body.versao) < 0 || Number(body.versao) >= 2147483647
    || typeof body.notificacoesAtivas !== "boolean" || typeof body.atualizacaoAutomatica !== "boolean"
    || (body.emailNotificacoes !== null && typeof body.emailNotificacoes !== "string")) throw new NuvemshopError(400, "Preferências inválidas. Intervalo permitido: 60 a 3600 segundos.");
  const email = body.emailNotificacoes ? invitationEmail(String(body.emailNotificacoes)) : null;
  if (body.notificacoesAtivas && !email) throw new NuvemshopError(400, "Informe o destinatário das notificações.");
  return { ...body, emailNotificacoes: email } as StoreSettings;
}
type Alert = { evento_id: string; destinatario: string; nome_produto: string; variante_id: string; quantidade: number; limite: number };
export function createStockAlertSender(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch) {
  const token = env.RESEND_API_KEY?.trim(), from = (env.STOCK_ALERT_FROM_EMAIL || env.PRIVACY_FROM_EMAIL)?.trim();
  if (!token || !from) return undefined;
  if (/[\r\n]/.test(token)) throw new Error("Credencial de notificações inválida.");
  invitationEmail(from);
  return async (alert: Alert) => {
    const response = await fetcher("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `stock/${alert.evento_id}` },
      body: JSON.stringify({ from, to: [alert.destinatario], subject: "PORTERO: alerta de estoque",
        text: `Produto: ${alert.nome_produto}\nVariante: ${alert.variante_id}\nSaldo observado: ${alert.quantidade}\nLimite de ruptura: ${alert.limite}\n${alert.quantidade < 0 ? "Estoque negativo: conferir a operação.\n" : ""}O saldo é o observado no monitoramento; consulte o estoque atual antes de operar.\nEvento: ${alert.evento_id}` }) });
    if (!response.ok) throw new Error("Envio não confirmado");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) throw new Error("Envio não confirmado");
    return result.id;
  };
}
export function createSettingsRepository(database: Pool, control: Pool, storeId: string) {
  return {
    async get(auth: AuthContext) {
      await activeStore(database, storeId, auth);
      const result = await database.query(`SELECT ${fields} FROM configuracoes_loja WHERE loja_id=$1`, [auth.lojaId]);
      const alerts = await database.query(`SELECT variante_id AS "varianteId",nome_produto AS nome,estado,evento_id AS "eventoId",observado_em AS "observadoEm"
        FROM alertas_estoque WHERE loja_id=$1 AND abaixo_limite AND estado IN ('pendente','em_envio','incerto','falhou') ORDER BY observado_em LIMIT 20`, [auth.lojaId]);
      return { ...(result.rows[0] ?? defaultSettings), alertas: alerts.rows };
    },
    async save(auth: AuthContext, input: StoreSettings) {
      return operationTransaction(database, storeId, auth, async client => {
        const locked = await client.query("SELECT pg_try_advisory_xact_lock(1372859533::int,$1::int) AS locked", [auth.lojaId]);
        if (!locked.rows[0]?.locked) throw new NuvemshopError(409, "Monitoramento em curso. Aguarde antes de alterar preferências.");
        const values = [auth.lojaId, input.limiteRuptura, input.notificacoesAtivas, input.emailNotificacoes, input.atualizacaoAutomatica, input.intervaloSegundos, auth.usuarioId];
        const result = input.versao === 0
          ? await client.query(`INSERT INTO configuracoes_loja(loja_id,limite_ruptura,notificacoes_ativas,email_notificacoes,atualizacao_automatica,intervalo_segundos,atualizado_por)
              VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(loja_id) DO NOTHING RETURNING ${fields}`, values)
          : await client.query(`UPDATE configuracoes_loja SET limite_ruptura=$2,notificacoes_ativas=$3,email_notificacoes=$4,atualizacao_automatica=$5,
              intervalo_segundos=$6,atualizado_por=$7,atualizado_em=now(),versao=versao+1,monitor_id=NULL WHERE loja_id=$1 AND versao=$8 RETURNING ${fields}`, [...values, input.versao]);
        if (result.rows.length !== 1) throw new NuvemshopError(409, "Preferências alteradas por outra sessão. Atualize antes de salvar.");
        return result.rows[0];
      });
    },
    async monitor(products: ReturnType<typeof createProductsClient>, sender: NonNullable<ReturnType<typeof createStockAlertSender>>, auth?: AuthContext) {
      const connection = await control.connect(); let shared = false, locked = false, discard = false, lockedStore = 0;
      const onError = () => { discard = true; }; connection.on("error", onError);
      try {
        const store = await activeStore(connection, storeId, auth);
        lockedStore = store.id;
        try {
          shared = (await connection.query("SELECT pg_try_advisory_lock_shared(7144630821938501::bigint) AS locked")).rows[0]?.locked === true;
          locked = shared && (await connection.query("SELECT pg_try_advisory_lock(1372859533::int,$1::int) AS locked", [store.id])).rows[0]?.locked === true;
        } catch (error) { discard = true; throw error; }
        if (!shared || !locked) throw new NuvemshopError(409, "Outro processamento está ativo. Monitoramento não iniciado.");
        await activeStore(connection, storeId, auth);
        const runId = randomUUID();
        const saved = await connection.query(`UPDATE configuracoes_loja SET monitor_id=$2 WHERE loja_id=$1 AND notificacoes_ativas RETURNING ${fields}`, [store.id, runId]);
        const settings = saved.rows[0];
        if (!settings?.notificacoesAtivas) return { habilitado: false, paginas: 0, enviados: 0, incertos: 0 };
        let page = Number(settings.monitorProximaPagina), pages = 0, next: number | null = page;
        const started = Date.now();
        for (; pages < 3 && next !== null && Date.now() - started < 25000; pages++) {
          if (discard) throw new Error("Conexão de controle perdida");
          const result = await products.list(store, page);
          if (discard) throw new Error("Conexão de controle perdida");
          const rows = result.items.map((item: InventoryItem) => ({ variante: item.varianteId, produto: item.produtoId, nome: item.nome.slice(0, 300), quantidade: item.quantidade, evento: randomUUID() }));
          next = result.nextPage;
          await operationTransaction(database, storeId, auth, async client => {
            const owned = await client.query("SELECT loja_id FROM configuracoes_loja WHERE loja_id=$1 AND monitor_id=$2 FOR UPDATE", [store.id, runId]);
            if (owned.rowCount !== 1) throw new NuvemshopError(409, "Monitoramento substituído. Este processo não pode gravar outro lote.");
            await client.query(`INSERT INTO alertas_estoque(loja_id,variante_id,produto_id,nome_produto,quantidade,limite,abaixo_limite,evento_id,estado,destinatario)
              SELECT $1,x.variante,x.produto,x.nome,x.quantidade,$2,COALESCE(x.quantidade<=$2,false),x.evento,
                CASE WHEN x.quantidade<=$2 THEN 'pendente' ELSE 'normal' END,$3
              FROM jsonb_to_recordset($4::jsonb) AS x(variante text,produto text,nome text,quantidade integer,evento uuid)
              ON CONFLICT(loja_id,variante_id) DO UPDATE SET produto_id=EXCLUDED.produto_id,nome_produto=EXCLUDED.nome_produto,
                quantidade=EXCLUDED.quantidade,limite=EXCLUDED.limite,abaixo_limite=EXCLUDED.abaixo_limite,observado_em=now(),
                evento_id=CASE WHEN NOT alertas_estoque.abaixo_limite AND EXCLUDED.abaixo_limite THEN EXCLUDED.evento_id ELSE alertas_estoque.evento_id END,
                estado=CASE WHEN NOT EXCLUDED.abaixo_limite THEN 'normal' WHEN NOT alertas_estoque.abaixo_limite THEN 'pendente' ELSE alertas_estoque.estado END,
                destinatario=CASE WHEN NOT alertas_estoque.abaixo_limite OR alertas_estoque.estado='pendente' THEN EXCLUDED.destinatario ELSE alertas_estoque.destinatario END,
                envio_iniciado_em=CASE WHEN NOT alertas_estoque.abaixo_limite AND EXCLUDED.abaixo_limite THEN NULL ELSE alertas_estoque.envio_iniciado_em END,
                enviado_em=CASE WHEN NOT alertas_estoque.abaixo_limite AND EXCLUDED.abaixo_limite THEN NULL ELSE alertas_estoque.enviado_em END,
                provedor_id=CASE WHEN NOT alertas_estoque.abaixo_limite AND EXCLUDED.abaixo_limite THEN NULL ELSE alertas_estoque.provedor_id END`,
            [store.id, settings.limiteRuptura, settings.emailNotificacoes, JSON.stringify(rows)]);
            await client.query("UPDATE configuracoes_loja SET monitor_proxima_pagina=$2,monitor_em=now(),monitor_resultado=$3 WHERE loja_id=$1", [store.id, next ?? 1, next === null ? "completo" : "parcial"]);
          });
          page = next ?? 1;
        }
        let sent = 0, uncertain = 0;
        // A confirmação persistente antecede o envio. Em envio/incerta nunca é retomada automaticamente.
        for (let index = 0; index < 5 && Date.now() - started < 40000; index++) {
          if (discard) throw new Error("Conexão de controle perdida");
          const claimed = await operationTransaction(database, storeId, auth, async client => {
            const owned = await client.query("SELECT loja_id FROM configuracoes_loja WHERE loja_id=$1 AND monitor_id=$2 FOR UPDATE", [store.id, runId]);
            if (owned.rowCount !== 1) throw new NuvemshopError(409, "Monitoramento substituído. Nenhum novo envio será iniciado.");
            return client.query(`UPDATE alertas_estoque SET estado='em_envio',envio_iniciado_em=now()
            WHERE loja_id=$1 AND variante_id=(SELECT variante_id FROM alertas_estoque WHERE loja_id=$1 AND abaixo_limite AND estado='pendente'
              AND observado_em>=now()-interval '5 minutes' ORDER BY observado_em LIMIT 1) AND estado='pendente' RETURNING *`, [store.id]);
          });
          const alert = claimed.rows[0]; if (!alert) break;
          if (discard) throw new Error("Conexão de controle perdida antes do envio");
          try {
            const providerId = await sender(alert);
            const updated = await database.query("UPDATE alertas_estoque SET estado='enviado',enviado_em=now(),provedor_id=$3 WHERE loja_id=$1 AND evento_id=$2 AND estado='em_envio'", [store.id, alert.evento_id, providerId]);
            if (updated.rowCount !== 1) throw new Error("Confirmação local perdida");
            sent++;
          } catch {
            uncertain++;
            await database.query("UPDATE alertas_estoque SET estado='incerto' WHERE loja_id=$1 AND evento_id=$2 AND estado='em_envio'", [store.id, alert.evento_id]).catch(() => {});
          }
        }
        return { habilitado: true, paginas: pages, proximaPagina: next, abrangencia: next === null ? "ciclo concluído" : "parcial; há páginas pendentes", enviados: sent, incertos: uncertain };
      } finally {
        if (locked && !discard) try { discard = (await connection.query("SELECT pg_advisory_unlock(1372859533::int,$1::int) AS unlocked", [lockedStore])).rows[0]?.unlocked !== true; } catch { discard = true; }
        if (shared && !discard) try { discard = (await connection.query("SELECT pg_advisory_unlock_shared(7144630821938501::bigint) AS unlocked")).rows[0]?.unlocked !== true; } catch { discard = true; }
        try { connection.release(discard); } finally { connection.removeListener("error", onError); }
      }
    },
  };
}
export type SettingsOptions = { repository: ReturnType<typeof createSettingsRepository>; products: ReturnType<typeof createProductsClient>; sender?: ReturnType<typeof createStockAlertSender>; notificationsEnabled?: boolean };
export function createSettingsRouter(secret: string, options?: SettingsOptions) {
  const router = Router(); router.use(createSessionService(secret).authenticate);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.all(["/", "/monitor"], async (req, res) => {
    if (!options) { res.status(503).json({ message: "Preferências ainda não habilitadas. O fluxo existente continua disponível." }); return; }
    try {
      if (Object.keys(req.query).length) throw new NuvemshopError(400, "Parâmetros não permitidos.");
      const auth = res.locals.auth as AuthContext;
      if (req.path === "/monitor" && req.method === "POST") {
        object(req.body, []);
        if (!options.sender) throw new NuvemshopError(503, "Envio de notificações não configurado ou desabilitado.");
        res.json(await options.repository.monitor(options.products, options.sender, auth));
      } else if (req.path === "/" && req.method === "GET") res.json({ ...await options.repository.get(auth), envioConfigurado: !!options.sender });
      else if (req.path === "/" && req.method === "PUT") {
        const input = validateSettings(req.body);
        if (input.notificacoesAtivas && !options.sender) throw new NuvemshopError(503, "Configure e habilite o envio antes de ativar notificações.");
        res.json({ ...await options.repository.save(auth, input), envioConfigurado: !!options.sender });
      } else res.status(405).json({ message: "Método não permitido." });
    } catch (error) { res.status(error instanceof NuvemshopError ? error.status : 503).json({ message: error instanceof NuvemshopError ? error.message : "Preferências ou monitoramento não confirmados. Atualize a consulta." }); }
  });
  return router;
}
export function createMonitorRouter(cronSecret: string | undefined, options?: SettingsOptions) {
  const router = Router(); router.get("/stock-monitor", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!options?.sender) {
      if (options?.notificationsEnabled) res.status(503).json({ message: "Envio habilitado sem configuração válida. Nenhum monitoramento executado." });
      else res.json({ habilitado: false });
      return;
    }
    const received = req.get("Authorization") ?? "", expected = `Bearer ${cronSecret ?? ""}`;
    if (!cronSecret || Object.keys(req.query).length || !timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(expected).digest())) { res.status(401).json({ message: "Agendamento não autorizado." }); return; }
    try { res.json(await options.repository.monitor(options.products, options.sender)); }
    catch { res.status(503).json({ message: "Monitoramento não concluído. Confira o estado persistente antes de repetir." }); }
  }); return router;
}
