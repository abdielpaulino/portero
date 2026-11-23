import type { Pool, PoolClient } from "pg";
import type { AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import type { StoreCredentials } from "../nuvemshop/products.js";

export async function activeStore(client: Pick<PoolClient, "query">, storeId: string, auth?: AuthContext): Promise<StoreCredentials> {
  const found = auth
    ? await client.query(`SELECT l.id,l.nuvemshop_store_id AS "nuvemshopStoreId",l.access_token AS "accessToken" FROM usuarios_app u
        JOIN lojas l ON l.id=u.loja_id WHERE u.id=$1 AND l.id=$2 AND l.nuvemshop_store_id=$3
        AND l.status IN ('ativa','pendente') AND length(btrim(l.access_token))>0`, [auth.usuarioId, auth.lojaId, storeId])
    : await client.query(`SELECT id,nuvemshop_store_id AS "nuvemshopStoreId",access_token AS "accessToken",status,
        length(btrim(access_token))>0 AS conectada FROM lojas LIMIT 2`);
  if (found.rows.length !== 1 || found.rows[0].nuvemshopStoreId !== storeId
    || (!auth && (!found.rows[0].conectada || !["ativa", "pendente"].includes(found.rows[0].status)))) throw new NuvemshopError(403, "Loja indisponível para esta operação.");
  return found.rows[0];
}

export async function operationTransaction<T>(database: Pool, storeId: string, auth: AuthContext | undefined,
  work: (client: PoolClient, store: StoreCredentials) => Promise<T>): Promise<T> {
  const client = await database.connect(); let discard = false;
  const error = () => { discard = true; }; client.on("error", error);
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock_shared(7144630821938501::bigint) AS locked");
    if (!lock.rows[0]?.locked) throw new NuvemshopError(409, "Instalação em atualização. Consulte a operação antes de continuar.");
    const result = await work(client, await activeStore(client, storeId, auth));
    await client.query("COMMIT"); return result;
  } catch (failure) { await client.query("ROLLBACK").catch(() => { discard = true; }); throw failure; }
  finally { try { client.release(discard); } finally { client.removeListener("error", error); } }
}
