import { pool } from "../db/client.js";
import type { Pool } from "pg";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { StoreCredentials } from "../nuvemshop/products.js";
import type { StockContext, StockRecord, StockRepository } from "./service.js";

const fields = `id, usuario_id AS "usuarioId", produto_id AS "produtoId", variant_id AS "variantId",
  quantidade_baixada AS "quantidadeBaixada", status_sincronizacao AS "statusSincronizacao"`;
export function createStockRepository(database: Pool, externalSalesEnabled = false): StockRepository { return {
  async withLock(auth, target, work, saleId) {
    const connection = await database.connect();
    let locked = false;
    let installationLocked = false;
    let discard = false;
    let variantId: string | undefined;
    let lockedSale: number | undefined;
    const onError = () => { discard = true; };
    connection.on("error", onError);
    try {
      // Desinstalação e reautorização exigem exclusividade sobre esta instalação.
      try {
        const installationLock = await connection.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock_shared(7144630821938501::bigint) AS locked");
        if (typeof installationLock.rows[0]?.locked !== "boolean") throw new Error();
        installationLocked = installationLock.rows[0].locked;
      } catch (error) { discard = true; throw error; }
      if (!installationLocked) throw new NuvemshopError(503, "A integração está sendo atualizada. Consulte a operação antes de continuar.");
      const stores = await connection.query<StoreCredentials>(
        `SELECT l.id, l.nuvemshop_store_id AS "nuvemshopStoreId", l.access_token AS "accessToken"
         FROM usuarios_app u JOIN lojas l ON l.id = u.loja_id WHERE u.id = $1 AND l.id = $2
           AND length(btrim(l.access_token)) > 0 AND l.status IN ('pendente', 'ativa')`, [auth.usuarioId, auth.lojaId]);
      if (stores.rows.length !== 1) throw new NuvemshopError(403, "Loja indisponível para esta conta.");
      const find = async (id: number) => {
        const found = await connection.query<StockRecord>(`SELECT ${fields} FROM baixas_estoque
          WHERE id = $1 AND loja_id = $2 AND usuario_id = $3`, [id, auth.lojaId, auth.usuarioId]);
        if (found.rows.length !== 1) throw new NuvemshopError(404, "Operação indisponível para esta conta e loja.");
        return found.rows[0];
      };
      const first = typeof target === "number" ? await find(target) : undefined;
      variantId = first ? first.variantId : (target as { varianteId: string }).varianteId;
      // Lock entre instâncias; exige conexão direta ou Session pooler.
      try {
        const lock = await connection.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked", [auth.lojaId, variantId]);
        if (typeof lock.rows[0]?.locked !== "boolean") throw new Error();
        locked = lock.rows[0].locked;
      } catch (error) { discard = true; throw error; }
      if (!locked) throw new NuvemshopError(409, "A variante está sendo processada. Aguarde e consulte a mesma operação.");
      const operation = typeof target === "number" ? await find(target) : undefined;
      if (operation && operation.variantId !== variantId) throw new NuvemshopError(409, "Os dados da operação foram alterados. Solicite conferência.");
      let externalSale: StockContext["externalSale"];
      if (operation) {
        const extension = await connection.query("SELECT to_regclass('public.itens_venda_externa')::text AS tabela");
        if ((externalSalesEnabled || saleId !== undefined) && !extension.rows[0]?.tabela) throw new NuvemshopError(503, "Extensão comercial indisponível. Confira a migração antes de executar.");
        if (extension.rows[0]?.tabela) {
          const linked = await connection.query<{ id: number; situacao: string; valida: boolean }>(`SELECT v.id,v.situacao,
            (v.loja_id=$2 AND v.usuario_id=$3 AND i.produto_id=$4 AND i.variante_id=$5 AND i.quantidade=$6) AS valida
            FROM itens_venda_externa i JOIN vendas_externas v ON v.id=i.venda_id WHERE i.baixa_id=$1`,
          [operation.id, auth.lojaId, auth.usuarioId, operation.produtoId, operation.variantId, operation.quantidadeBaixada]);
          if (linked.rows.length && linked.rows[0].valida !== true) throw new NuvemshopError(409, "Vínculo comercial inconsistente. Solicite conferência.");
          externalSale = linked.rows[0];
          if (saleId !== undefined && externalSale?.id !== saleId) throw new NuvemshopError(409, "Baixa não corresponde ao item da venda.");
          if (externalSale && saleId === undefined) {
            // O fluxo comercial já mantém este lock em uma conexão de controle separada.
            try {
              const lock = await connection.query("SELECT pg_try_advisory_lock(1372859531::int, $1::int) AS locked", [externalSale.id]);
              if (typeof lock.rows[0]?.locked !== "boolean") throw new Error();
              if (!lock.rows[0].locked) throw new NuvemshopError(409, "Venda em processamento. Consulte o registro.");
              lockedSale = externalSale.id;
            } catch (error) { if (!(error instanceof NuvemshopError)) discard = true; throw error; }
            const current = await connection.query("SELECT situacao FROM vendas_externas WHERE id=$1 AND loja_id=$2", [externalSale.id, auth.lojaId]);
            if (current.rows.length !== 1) throw new NuvemshopError(409, "Venda indisponível.");
            externalSale = { id: externalSale.id, situacao: current.rows[0].situacao };
          }
        }
      }
      const context: StockContext = {
        store: stores.rows[0], operation, externalSale,
        async hasUnresolved(exceptId = 0) {
          const found = await connection.query(`SELECT id FROM baixas_estoque WHERE loja_id = $1 AND variant_id = $2
            AND id <> $3 AND status_sincronizacao NOT IN ('sincronizada', 'rejeitada') LIMIT 1`, [auth.lojaId, variantId, exceptId]);
          return found.rows.length > 0;
        },
        async create(command) {
          const inserted = await connection.query<StockRecord>(`INSERT INTO baixas_estoque
            (loja_id, usuario_id, produto_id, variant_id, quantidade_baixada, status_sincronizacao)
            VALUES ($1, $2, $3, $4, $5, 'registrada') RETURNING ${fields}`,
          [auth.lojaId, auth.usuarioId, command.produtoId, command.varianteId, command.quantidade]);
          if (inserted.rows.length !== 1) throw new NuvemshopError(503, "Criação não confirmada. Recupere a operação pelo histórico.");
          return inserted.rows[0];
        },
        async prepare(id, sku) {
          const updated = await connection.query(`UPDATE baixas_estoque SET sku = $4, status_sincronizacao = 'em_processamento'
            WHERE id = $1 AND loja_id = $2 AND usuario_id = $3 AND status_sincronizacao = 'registrada'`, [id, auth.lojaId, auth.usuarioId, sku]);
          if (updated.rowCount !== 1) throw new NuvemshopError(503, "Preparação não confirmada. Consulte a mesma operação antes de continuar.");
        },
        async status(id, status) {
          const previous = status === "rejeitada" ? "registrada" : "em_processamento";
          const updated = await connection.query(`UPDATE baixas_estoque SET status_sincronizacao = $4
            WHERE id = $1 AND loja_id = $2 AND usuario_id = $3 AND status_sincronizacao = $5`, [id, auth.lojaId, auth.usuarioId, status, previous]);
          if (updated.rowCount !== 1) throw new NuvemshopError(503, "Estado da operação não confirmado. Solicite conferência.");
        },
      };
      return await work(context);
    } catch (error) {
      if (error instanceof NuvemshopError) throw error;
      throw new NuvemshopError(503, "Registro local indisponível. Consulte o histórico antes de tentar novamente.");
    } finally {
      if (lockedSale !== undefined && !discard) {
        try { const result = await connection.query("SELECT pg_advisory_unlock(1372859531::int, $1::int) AS unlocked", [lockedSale]); discard = result.rows[0]?.unlocked !== true; }
        catch { discard = true; }
      }
      if (locked && !discard) {
        try {
          const unlocked = await connection.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock($1::int, hashtext($2)) AS unlocked", [auth.lojaId, variantId]);
          discard = unlocked.rows[0].unlocked !== true;
        } catch { discard = true; }
      }
      if (installationLocked && !discard) {
        try {
          const unlocked = await connection.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock_shared(7144630821938501::bigint) AS unlocked");
          discard = unlocked.rows[0]?.unlocked !== true;
        } catch { discard = true; }
      }
      try { connection.release(discard); } finally { connection.removeListener("error", onError); }
    }
  },
}; }
export const stockRepository = createStockRepository(pool);
