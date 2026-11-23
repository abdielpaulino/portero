import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { lojas, usuariosApp } from "../db/schema.js";

export type UsuarioLogin = {
  id: number;
  nome: string;
  email: string;
  senhaHash: string;
};

export type LojaLogin = { id: number; nomeLoja: string };

export interface AuthRepository {
  buscarUsuariosPorEmail(email: string): Promise<UsuarioLogin[]>;
  listarLojas(usuarioId: number): Promise<LojaLogin[]>;
}

export const authRepository: AuthRepository = {
  buscarUsuariosPorEmail(email) {
    return db.select({
      id: usuariosApp.id,
      nome: usuariosApp.nome,
      email: usuariosApp.email,
      senhaHash: usuariosApp.senhaHash,
    }).from(usuariosApp)
      .where(sql`lower(btrim(${usuariosApp.email})) = ${email}`)
      .limit(2);
  },

  listarLojas(usuarioId) {
    return db.select({ id: lojas.id, nomeLoja: lojas.nomeLoja })
      .from(usuariosApp)
      .innerJoin(lojas, eq(lojas.id, usuariosApp.lojaId))
      .where(and(eq(usuariosApp.id, usuarioId), sql`length(btrim(${lojas.accessToken})) > 0`, sql`${lojas.status} IN ('pendente', 'ativa')`))
      .limit(1);
  },
};
