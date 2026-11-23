import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

export const lojas = pgTable("lojas", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  nuvemshopStoreId: text("nuvemshop_store_id").notNull().unique("lojas_nuvemshop_store_id_key"),
  accessToken: text("access_token").notNull(),
  scope: text("scope"),
  nomeLoja: text("nome_loja").notNull(),
  status: text("status").notNull().default("pendente"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

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
]).enableRLS();

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
]).enableRLS();

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
]).enableRLS();

// A baixa legada confere vínculos comerciais já existentes, mesmo com a tela desativada.
const monetary = (column: AnyPgColumn) => sql`${column} <> 'NaN'::numeric AND ${column} BETWEEN 0 AND 9999999999999999.99 AND scale(${column}) <= 2`;
export const vendasExternas = pgTable("vendas_externas", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  lojaId: integer("loja_id").notNull().references(() => lojas.id),
  usuarioId: integer("usuario_id").notNull().references(() => usuariosApp.id),
  requisicaoId: uuid("requisicao_id").notNull(),
  conteudoHash: text("conteudo_hash").notNull(),
  canal: text("canal").notNull(), formaPagamento: text("forma_pagamento").notNull(), moeda: text("moeda").notNull(),
  vendidaEm: timestamp("vendida_em", { withTimezone: true }).notNull().defaultNow(),
  situacao: text("situacao").notNull().default("confirmada"),
  subtotal: numeric("subtotal").notNull(),
  descontosItens: numeric("descontos_itens").notNull(),
  descontoVenda: numeric("desconto_venda").notNull(),
  total: numeric("total").notNull(),
  valorRecebido: numeric("valor_recebido").notNull().default("0"),
  valorEstornado: numeric("valor_estornado").notNull().default("0"),
  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
}, table => [
  unique("vendas_externas_requisicao_unique").on(table.lojaId, table.requisicaoId),
  index("vendas_externas_loja_data_idx").on(table.lojaId, table.vendidaEm.desc(), table.id.desc()),
  check("vendas_externas_conteudo_hash_check", sql`${table.conteudoHash} ~ '^[a-f0-9]{64}$'`),
  check("vendas_externas_canal_check", sql`length(btrim(${table.canal})) BETWEEN 1 AND 80`),
  check("vendas_externas_forma_pagamento_check", sql`length(btrim(${table.formaPagamento})) BETWEEN 1 AND 80`),
  check("vendas_externas_moeda_check", sql`${table.moeda} ~ '^[A-Z]{3}$'`),
  check("vendas_externas_situacao_check", sql`${table.situacao} IN ('confirmada', 'cancelada')`),
  check("vendas_externas_subtotal_check", monetary(table.subtotal)),
  check("vendas_externas_descontos_itens_check", monetary(table.descontosItens)),
  check("vendas_externas_desconto_venda_check", monetary(table.descontoVenda)),
  check("vendas_externas_total_check", sql`${monetary(table.total)} AND ${table.total} = ${table.subtotal} - ${table.descontosItens} - ${table.descontoVenda}`),
  check("vendas_externas_valor_recebido_check", monetary(table.valorRecebido)),
  check("vendas_externas_valor_estornado_check", monetary(table.valorEstornado)),
  check("vendas_externas_financeiro_check", sql`${table.valorRecebido} >= 0 AND ${table.valorRecebido} - ${table.valorEstornado} <= ${table.total} AND ${table.valorEstornado} >= 0 AND ${table.valorEstornado} <= ${table.valorRecebido}`),
  check("vendas_externas_cancelamento_check", sql`(${table.situacao} = 'cancelada') = (${table.canceladaEm} IS NOT NULL)`),
]).enableRLS();

export const itensVendaExterna = pgTable("itens_venda_externa", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  vendaId: integer("venda_id").notNull().references(() => vendasExternas.id, { onDelete: "cascade" }),
  produtoId: text("produto_id").notNull(), varianteId: text("variante_id").notNull(),
  nomeProduto: text("nome_produto").notNull(), nomeVariante: text("nome_variante").notNull(), sku: text("sku"),
  quantidade: integer("quantidade").notNull(),
  precoUnitario: numeric("preco_unitario").notNull(),
  desconto: numeric("desconto").notNull(),
  total: numeric("total").notNull(),
  baixaId: integer("baixa_id").unique().references(() => baixasEstoque.id),
}, table => [
  unique("itens_venda_externa_variante_unique").on(table.vendaId, table.varianteId),
  check("itens_venda_externa_produto_id_check", sql`${table.produtoId} ~ '^[1-9][0-9]{0,19}$'`),
  check("itens_venda_externa_variante_id_check", sql`${table.varianteId} ~ '^[1-9][0-9]{0,19}$'`),
  check("itens_venda_externa_quantidade_check", sql`${table.quantidade} > 0`),
  check("itens_venda_externa_preco_unitario_check", monetary(table.precoUnitario)),
  check("itens_venda_externa_desconto_check", monetary(table.desconto)),
  check("itens_venda_externa_total_check", sql`${monetary(table.total)} AND ${table.total} = ${table.quantidade}::numeric * ${table.precoUnitario} - ${table.desconto}`),
]).enableRLS();

export const movimentosFinanceirosVenda = pgTable("movimentos_financeiros_venda", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  vendaId: integer("venda_id").notNull().references(() => vendasExternas.id, { onDelete: "cascade" }),
  usuarioId: integer("usuario_id").notNull().references(() => usuariosApp.id),
  requisicaoId: uuid("requisicao_id").notNull(), conteudoHash: text("conteudo_hash").notNull(), tipo: text("tipo").notNull(),
  valor: numeric("valor").notNull(), formaPagamento: text("forma_pagamento").notNull(),
  ocorridoEm: timestamp("ocorrido_em", { withTimezone: true }).notNull(),
  registradoEm: timestamp("registrado_em", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("movimentos_financeiros_venda_requisicao_unique").on(table.vendaId, table.requisicaoId),
  index("movimentos_financeiros_venda_data_idx").on(table.ocorridoEm, table.vendaId),
  check("movimentos_financeiros_venda_conteudo_hash_check", sql`${table.conteudoHash} ~ '^[a-f0-9]{64}$'`),
  check("movimentos_financeiros_venda_tipo_check", sql`${table.tipo} IN ('recebimento', 'estorno')`),
  check("movimentos_financeiros_venda_valor_check", sql`${monetary(table.valor)} AND ${table.valor} > 0`),
  check("movimentos_financeiros_venda_forma_pagamento_check", sql`length(btrim(${table.formaPagamento})) BETWEEN 1 AND 80`),
]).enableRLS();

export const convitesConta = pgTable("convites_conta", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  lojaId: integer("loja_id").notNull(), email: text("email").notNull(),
  segredoHash: text("segredo_hash").notNull().unique("convites_conta_segredo_hash_key"),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  usadoEm: timestamp("usado_em", { withTimezone: true }), revogadoEm: timestamp("revogado_em", { withTimezone: true }),
  usuarioId: integer("usuario_id"),
}, table => [
  foreignKey({ name: "convites_conta_loja_id_fkey", columns: [table.lojaId], foreignColumns: [lojas.id] }).onDelete("cascade"),
  foreignKey({ name: "convites_conta_usuario_id_fkey", columns: [table.usuarioId], foreignColumns: [usuariosApp.id] }).onDelete("set null"),
  uniqueIndex("convites_conta_ativo_email_idx").on(table.lojaId, table.email).where(sql`${table.usadoEm} IS NULL AND ${table.revogadoEm} IS NULL`),
  check("convites_conta_email_check", sql`${table.email} = lower(btrim(${table.email})) AND length(${table.email}) BETWEEN 3 AND 254`),
  check("convites_conta_segredo_hash_check", sql`${table.segredoHash} ~ '^[a-f0-9]{64}$'`),
  check("convites_conta_expiracao_check", sql`${table.expiraEm} > ${table.criadoEm}`),
  check("convites_conta_consumo_check", sql`${table.usadoEm} IS NULL OR ${table.revogadoEm} IS NULL`),
]).enableRLS();

export const conferenciasBaixa = pgTable("conferencias_baixa", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(), lojaId: integer("loja_id").notNull(),
  baixaId: integer("baixa_id").notNull(), usuarioId: integer("usuario_id").notNull(),
  requisicaoId: uuid("requisicao_id").notNull(), conteudoHash: text("conteudo_hash").notNull(),
  conclusao: text("conclusao").notNull(), quantidadeComprovada: integer("quantidade_comprovada"),
  evidenciaTipo: text("evidencia_tipo").notNull(), evidenciaReferencia: text("evidencia_referencia").notNull(),
  justificativa: text("justificativa").notNull(), statusAnterior: text("status_anterior").notNull(), statusFinal: text("status_final").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ name: "conferencias_baixa_loja_id_fkey", columns: [table.lojaId], foreignColumns: [lojas.id] }),
  foreignKey({ name: "conferencias_baixa_baixa_id_fkey", columns: [table.baixaId], foreignColumns: [baixasEstoque.id] }),
  foreignKey({ name: "conferencias_baixa_usuario_id_fkey", columns: [table.usuarioId], foreignColumns: [usuariosApp.id] }),
  unique("conferencias_baixa_loja_id_requisicao_id_key").on(table.lojaId, table.requisicaoId),
  index("conferencias_baixa_operacao_idx").on(table.baixaId, table.id.desc()),
  check("conferencias_baixa_conteudo_hash_check", sql`${table.conteudoHash} ~ '^[a-f0-9]{64}$'`),
  check("conferencias_baixa_conclusao_check", sql`${table.conclusao} IN ('integral','nao_aplicada','parcial','inconclusiva')`),
  check("conferencias_baixa_quantidade_comprovada_check", sql`${table.quantidadeComprovada} >= 0`),
  check("conferencias_baixa_evidencia_tipo_check", sql`${table.evidenciaTipo} IN ('registro_movimentacao','documento_operacional')`),
  check("conferencias_baixa_evidencia_referencia_check", sql`length(btrim(${table.evidenciaReferencia})) BETWEEN 8 AND 500`),
  check("conferencias_baixa_justificativa_check", sql`length(btrim(${table.justificativa})) BETWEEN 20 AND 2000`),
  check("conferencias_baixa_conclusao_quantidade_check", sql`(${table.conclusao}='inconclusiva') = (${table.quantidadeComprovada} IS NULL)`),
]).enableRLS();

export const configuracoesLoja = pgTable("configuracoes_loja", {
  lojaId: integer("loja_id").primaryKey(), limiteRuptura: integer("limite_ruptura").notNull().default(0),
  notificacoesAtivas: boolean("notificacoes_ativas").notNull().default(false), emailNotificacoes: text("email_notificacoes"),
  atualizacaoAutomatica: boolean("atualizacao_automatica").notNull().default(true), intervaloSegundos: integer("intervalo_segundos").notNull().default(60),
  versao: integer("versao").notNull().default(1), atualizadoPor: integer("atualizado_por").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  monitorProximaPagina: integer("monitor_proxima_pagina").notNull().default(1), monitorEm: timestamp("monitor_em", { withTimezone: true }), monitorResultado: text("monitor_resultado"),
  monitorId: uuid("monitor_id"),
}, table => [
  foreignKey({ name: "configuracoes_loja_loja_id_fkey", columns: [table.lojaId], foreignColumns: [lojas.id] }).onDelete("cascade"),
  foreignKey({ name: "configuracoes_loja_atualizado_por_fkey", columns: [table.atualizadoPor], foreignColumns: [usuariosApp.id] }),
  check("configuracoes_loja_limite_ruptura_check", sql`${table.limiteRuptura} BETWEEN 0 AND 2147483647`),
  check("configuracoes_loja_email_notificacoes_check", sql`length(${table.emailNotificacoes}) BETWEEN 3 AND 254 AND ${table.emailNotificacoes}=lower(btrim(${table.emailNotificacoes}))`),
  check("configuracoes_loja_intervalo_segundos_check", sql`${table.intervaloSegundos} BETWEEN 60 AND 3600`),
  check("configuracoes_loja_versao_check", sql`${table.versao}>0`),
  check("configuracoes_loja_monitor_proxima_pagina_check", sql`${table.monitorProximaPagina} BETWEEN 1 AND 10000`),
  check("configuracoes_loja_destinatario_check", sql`NOT ${table.notificacoesAtivas} OR ${table.emailNotificacoes} IS NOT NULL`),
]).enableRLS();

export const alertasEstoque = pgTable("alertas_estoque", {
  lojaId: integer("loja_id").notNull(), varianteId: text("variante_id").notNull(), produtoId: text("produto_id").notNull(), nomeProduto: text("nome_produto").notNull(),
  quantidade: integer("quantidade"), limite: integer("limite").notNull(), abaixoLimite: boolean("abaixo_limite").notNull(),
  eventoId: uuid("evento_id").notNull().unique("alertas_estoque_evento_id_key"), estado: text("estado").notNull(), destinatario: text("destinatario"),
  observadoEm: timestamp("observado_em", { withTimezone: true }).notNull().defaultNow(), envioIniciadoEm: timestamp("envio_iniciado_em", { withTimezone: true }),
  enviadoEm: timestamp("enviado_em", { withTimezone: true }), provedorId: text("provedor_id"),
}, table => [
  primaryKey({ name: "alertas_estoque_pkey", columns: [table.lojaId, table.varianteId] }),
  foreignKey({ name: "alertas_estoque_loja_id_fkey", columns: [table.lojaId], foreignColumns: [configuracoesLoja.lojaId] }).onDelete("cascade"),
  check("alertas_estoque_variante_id_check", sql`${table.varianteId} ~ '^[1-9][0-9]{0,19}$'`),
  check("alertas_estoque_produto_id_check", sql`${table.produtoId} ~ '^[1-9][0-9]{0,19}$'`),
  check("alertas_estoque_limite_check", sql`${table.limite}>=0`),
  check("alertas_estoque_estado_check", sql`${table.estado} IN ('normal','pendente','em_envio','enviado','incerto','falhou')`),
  check("alertas_estoque_saldo_check", sql`NOT ${table.abaixoLimite} OR ${table.quantidade} IS NOT NULL`),
  check("alertas_estoque_destinatario_check", sql`${table.estado} NOT IN ('pendente','em_envio','enviado') OR ${table.destinatario} IS NOT NULL`),
]).enableRLS();
