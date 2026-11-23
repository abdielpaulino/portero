import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { lojas, usuariosApp } from "../db/schema.js";
import type { StoreCredentials } from "../nuvemshop/products.js";

export interface InventoryRepository {
  listarLojas(usuarioId: number): Promise<StoreCredentials[]>;
}

export const inventoryRepository: InventoryRepository = {
  listarLojas(usuarioId) {
    return db.select({ id: lojas.id, nuvemshopStoreId: lojas.nuvemshopStoreId, accessToken: lojas.accessToken })
      .from(usuariosApp).innerJoin(lojas, eq(lojas.id, usuariosApp.lojaId))
      .where(and(eq(usuariosApp.id, usuarioId), sql`length(btrim(${lojas.accessToken})) > 0`, sql`${lojas.status} IN ('pendente', 'ativa')`)).limit(1);
  },
};
