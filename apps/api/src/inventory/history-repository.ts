import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { baixasEstoque, usuariosApp } from "../db/schema.js";
import type { StockHistoryRepository } from "./history.js";

export const stockHistoryRepository: StockHistoryRepository = {
  async listar(lojaId, page, pageSize) {
    const rows = await db.select({
      id: baixasEstoque.id,
      produtoId: baixasEstoque.produtoId,
      varianteId: baixasEstoque.variantId,
      sku: baixasEstoque.sku,
      quantidade: baixasEstoque.quantidadeBaixada,
      status: baixasEstoque.statusSincronizacao,
      criadoEm: baixasEstoque.criadoEm,
      usuario: { id: usuariosApp.id, nome: usuariosApp.nome, email: usuariosApp.email },
    }).from(baixasEstoque).innerJoin(usuariosApp, eq(usuariosApp.id, baixasEstoque.usuarioId))
      .where(eq(baixasEstoque.lojaId, lojaId))
      .orderBy(desc(baixasEstoque.criadoEm), desc(baixasEstoque.id))
      .limit(pageSize + 1).offset((page - 1) * pageSize);
    return rows.map((row) => ({ ...row, criadoEm: row.criadoEm.toISOString() }));
  },
};
