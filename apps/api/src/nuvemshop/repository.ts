import type { Pool } from "pg";
import { NuvemshopError, type LojaConectada } from "./oauth.js";

export const INSTALLATION_LOCK = "7144630821938501";
export const INITIAL_STATUS = "instalacao_inicializada";
export const PENDING_STATUS = "oauth_pendente";
export const CONSUMED_STATUS = "oauth_em_troca";
export type AuthorizationAttempt = { lojaId: number; generation: string; nonce: string };
export type InstallationPreparation = Omit<AuthorizationAttempt, "nonce">;
export interface NuvemshopRepository {
  verificarInstalacao(storeId: string): Promise<void>;
  prepararAutorizacao(storeId: string): Promise<InstallationPreparation>;
  iniciarAutorizacao(storeId: string): Promise<InstallationPreparation>;
  consumirAutorizacao(storeId: string, attempt: AuthorizationAttempt): Promise<void>;
  salvarLoja(loja: LojaConectada, attempt: AuthorizationAttempt): Promise<void>;
}
type Store = { id: number; nuvemshop_store_id: string; conectada: boolean; status: string; generation: string };
const fields = "id, nuvemshop_store_id, length(btrim(access_token)) > 0 AS conectada, status, extract(epoch from criado_em)::text AS generation";

export function checkInstallation(rows: { nuvemshop_store_id: string }[], storeId: string) {
  if (rows.length !== 1 || !storeId || rows[0].nuvemshop_store_id !== storeId) {
    throw new NuvemshopError(409, "A loja está ausente ou não corresponde à única loja desta instalação. Solicite conferência administrativa.");
  }
}
function preparation(rows: Store[], storeId: string, expected: string, attempt?: AuthorizationAttempt) {
  checkInstallation(rows, storeId);
  const row = rows[0];
  if (row.status !== expected || row.conectada || (attempt && (row.id !== attempt.lojaId || row.generation !== attempt.generation))) {
    throw new NuvemshopError(409, "A instalação não permite esta autorização. Solicite conferência administrativa.");
  }
  return row;
}
export function createNuvemshopRepository(database: Pool): NuvemshopRepository {
  async function transition(storeId: string, from: string, to: string, attempt?: AuthorizationAttempt, loja?: LojaConectada) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(7144630821938501::bigint) AS locked");
      if (!lock.rows[0]?.locked) throw new NuvemshopError(409, "Outra operação da instalação está em curso. Solicite conferência antes de tentar novamente.");
      const current = await client.query<Store>("SELECT " + fields + " FROM lojas LIMIT 2 FOR UPDATE");
      const row = preparation(current.rows, storeId, from, attempt);
      const changed = loja
        ? await client.query("UPDATE lojas SET access_token = $3, scope = $4, nome_loja = $5, status = 'ativa' WHERE id = $1 AND status = $2",
          [row.id, from, loja.accessToken, loja.scope, loja.nomeLoja])
        : await client.query("UPDATE lojas SET status = $3 WHERE id = $1 AND status = $2", [row.id, from, to]);
      if (changed.rowCount !== 1) throw new NuvemshopError(409, "Transição da instalação não confirmada.");
      await client.query("COMMIT");
      return { lojaId: row.id, generation: row.generation };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return {
    async verificarInstalacao(storeId) {
      const result = await database.query<Store>("SELECT " + fields + " FROM lojas LIMIT 2");
      checkInstallation(result.rows, storeId);
      // 'pendente' com token válido é o estado original da demo já conectada.
      if (!result.rows[0].conectada || !["pendente", "ativa"].includes(result.rows[0].status)) {
        throw new NuvemshopError(409, "A integração está indisponível. Solicite conferência administrativa.");
      }
    },
    async prepararAutorizacao(storeId) {
      const result = await database.query<Store>("SELECT " + fields + " FROM lojas LIMIT 2");
      const row = preparation(result.rows, storeId, INITIAL_STATUS);
      return { lojaId: row.id, generation: row.generation };
    },
    iniciarAutorizacao: storeId => transition(storeId, INITIAL_STATUS, PENDING_STATUS),
    async consumirAutorizacao(storeId, attempt) {
      await transition(storeId, PENDING_STATUS, CONSUMED_STATUS, attempt);
    },
    async salvarLoja(loja, attempt) {
      await transition(loja.nuvemshopStoreId, CONSUMED_STATUS, "ativa", attempt, loja);
    },
  };
}
