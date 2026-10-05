import { sql } from "drizzle-orm";
import { check, date, foreignKey, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const lojas = pgTable("lojas", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  nuvemshopStoreId: text("nuvemshop_store_id").notNull().unique("lojas_nuvemshop_store_id_key"),
  accessToken: text("access_token").notNull(),
  scope: text("scope"),
  nomeLoja: text("nome_loja").notNull(),
  status: text("status").notNull().default("pendente"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const acessosPermitidos = pgTable("acessos_permitidos", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  email: text("email").notNull(),
  lojaId: integer("loja_id").notNull().unique("acessos_permitidos_loja_id_key"),
  plano: text("plano").notNull(),
  pagoAte: date("pago_ate"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "acessos_permitidos_loja_id_fkey",
    columns: [table.lojaId],
    foreignColumns: [lojas.id],
  }),
]);

export const usuariosApp = pgTable("usuarios_app", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  lojaId: integer("loja_id").notNull(),
  nome: text("nome").notNull(),
  email: text("email").notNull(),
  senhaHash: text("senha_hash").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "usuarios_app_loja_id_fkey",
    columns: [table.lojaId],
    foreignColumns: [lojas.id],
  }),
  unique("usuarios_app_email_por_loja").on(table.lojaId, table.email),
]);

export const baixasEstoque = pgTable("baixas_estoque", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  lojaId: integer("loja_id").notNull(),
  usuarioId: integer("usuario_id").notNull(),
  produtoId: text("produto_id").notNull(),
  variantId: text("variant_id").notNull(),
  sku: text("sku"),
  quantidadeBaixada: integer("quantidade_baixada").notNull(),
  statusSincronizacao: text("status_sincronizacao").notNull().default("pendente"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "baixas_estoque_loja_id_fkey",
    columns: [table.lojaId],
    foreignColumns: [lojas.id],
  }),
  foreignKey({
    name: "baixas_estoque_usuario_id_fkey",
    columns: [table.usuarioId],
    foreignColumns: [usuariosApp.id],
  }),
  check("baixas_estoque_quantidade_baixada_check", sql`${table.quantidadeBaixada} > 0`),
]);
