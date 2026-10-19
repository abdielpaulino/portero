import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { lojas, usuariosApp, usuariosLojas } from "../db/schema.js";

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
      .from(usuariosLojas)
      .innerJoin(lojas, eq(lojas.id, usuariosLojas.lojaId))
      .where(eq(usuariosLojas.usuarioId, usuarioId))
      .orderBy(lojas.nomeLoja, lojas.id);
  },
};
