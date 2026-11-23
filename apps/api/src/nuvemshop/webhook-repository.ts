import type { Pool } from "pg";
import { NuvemshopError } from "./oauth.js";
import { checkInstallation } from "./repository.js";

export type StoreLifecycleEvent = "app/uninstalled" | "app/suspended" | "app/store_redact";
export interface WebhookRepository {
  handle(storeId: string, event: StoreLifecycleEvent): Promise<void>;
}
export function createWebhookRepository(database: Pool, timeoutMs = 1_500): WebhookRepository {
  return {
    async handle(storeId, event) {
      const client = await database.connect().catch(() => {
        throw new NuvemshopError(503, "Conexão indisponível para o evento. A entrega deve ser repetida.");
      });
      let released = false, discard = false, expired = false;
      const release = (destroy: boolean) => {
        if (released) return;
        released = true;
        client.release(destroy);
      };
      // Encerrar a conexão interrompe a transação; não confirmar trabalho ainda em execução.
      const timeout = setTimeout(() => { expired = true; release(true); }, timeoutMs);
      const query = async (text: string, values?: unknown[]) => {
        if (expired) throw new Error("Prazo do evento excedido");
        const result = await client.query(text, values);
        if (expired) throw new Error("Prazo do evento excedido");
        return result;
      };
      try {
        await query("BEGIN");
        // O lock exclusivo aguarda uma entrega posterior quando há uma baixa em curso.
        const lock = await query("SELECT pg_try_advisory_xact_lock(7144630821938501::bigint) AS locked");
        if (!lock.rows[0]?.locked) throw new NuvemshopError(503, "A instalação possui uma operação em curso. A entrega deve ser repetida.");
        const current = await query("SELECT id, nuvemshop_store_id FROM lojas LIMIT 2 FOR UPDATE");
        if (current.rows.length) {
          checkInstallation(current.rows, storeId);
          const lojaId = current.rows[0].id;
          if (event === "app/store_redact") {
            const operational = await query(`SELECT to_regclass('public.convites_conta')::text AS convites,
              to_regclass('public.conferencias_baixa')::text AS conferencias,to_regclass('public.configuracoes_loja')::text AS configuracoes`);
            if (operational.rows[0]?.convites) await query("DELETE FROM convites_conta WHERE loja_id = $1", [lojaId]);
            if (operational.rows[0]?.conferencias) await query("DELETE FROM conferencias_baixa WHERE loja_id = $1", [lojaId]);
            if (operational.rows[0]?.configuracoes) await query("DELETE FROM configuracoes_loja WHERE loja_id = $1", [lojaId]);
            const extension = await query("SELECT to_regclass('public.vendas_externas')::text AS tabela");
            if (extension.rows[0]?.tabela) await query("DELETE FROM vendas_externas WHERE loja_id = $1", [lojaId]);
            await query("DELETE FROM baixas_estoque WHERE loja_id = $1", [lojaId]);
            await query("DELETE FROM usuarios_app WHERE loja_id = $1", [lojaId]);
            await query("DELETE FROM acessos_permitidos WHERE loja_id = $1", [lojaId]);
            await query("DELETE FROM lojas WHERE id = $1", [lojaId]);
          } else {
            const status = event === "app/uninstalled" ? "desinstalada" : "suspensa";
            await query("UPDATE lojas SET access_token = '', scope = NULL, status = $2 WHERE id = $1 AND ($2 <> 'suspensa' OR status <> 'desinstalada')", [lojaId, status]);
          }
        }
        await query("COMMIT");
      } catch (error) {
        if (!expired) await query("ROLLBACK").catch(() => { discard = true; });
        if (error instanceof NuvemshopError) throw error;
        throw new NuvemshopError(503, "Não foi possível concluir o evento da integração. A entrega deve ser repetida.");
      } finally {
        clearTimeout(timeout);
        release(discard);
      }
    },
  };
}
