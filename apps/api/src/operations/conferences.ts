import { Router } from "express";
import type { Pool } from "pg";
import { createSessionService, type AuthContext } from "../auth/session.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import { hash, object, uuid } from "../sales/domain.js";
import { activeStore, operationTransaction } from "./database.js";

export type ConferenceInput = { conclusao: "integral" | "nao_aplicada" | "parcial" | "inconclusiva"; quantidadeComprovada: number | null;
  evidenciaTipo: "registro_movimentacao" | "documento_operacional"; evidenciaReferencia: string; justificativa: string; confirmoEvidencia: true };
export function validateConference(value: unknown): ConferenceInput {
  const body = object(value, ["conclusao", "quantidadeComprovada", "evidenciaTipo", "evidenciaReferencia", "justificativa", "confirmoEvidencia"]);
  if (!["integral", "nao_aplicada", "parcial", "inconclusiva"].includes(String(body.conclusao)) || body.confirmoEvidencia !== true
    || !["registro_movimentacao", "documento_operacional"].includes(String(body.evidenciaTipo))
    || typeof body.evidenciaReferencia !== "string" || body.evidenciaReferencia.trim().length < 8 || body.evidenciaReferencia.length > 500
    || typeof body.justificativa !== "string" || body.justificativa.trim().length < 20 || body.justificativa.length > 2000
    || /[\x00-\x1f]/.test(body.evidenciaReferencia) || /[\x00-\x08\x0b-\x1f]/.test(body.justificativa)
    || (body.conclusao === "inconclusiva" ? body.quantidadeComprovada !== null : !Number.isInteger(body.quantidadeComprovada) || Number(body.quantidadeComprovada) < 0))
    throw new NuvemshopError(400, "Informe conclusão, evidência documental e justificativa. Saldo atual não comprova a baixa.");
  return { conclusao: body.conclusao as ConferenceInput["conclusao"], quantidadeComprovada: body.quantidadeComprovada as number | null,
    evidenciaTipo: body.evidenciaTipo as ConferenceInput["evidenciaTipo"], evidenciaReferencia: body.evidenciaReferencia.trim(),
    justificativa: body.justificativa.trim(), confirmoEvidencia: true };
}
export function createConferenceRepository(database: Pool, storeId: string) {
  return {
    async list(auth: AuthContext, baixaId: number) {
      await activeStore(database, storeId, auth);
      const operation = await database.query("SELECT id FROM baixas_estoque WHERE id=$1 AND loja_id=$2", [baixaId, auth.lojaId]);
      if (operation.rows.length !== 1) throw new NuvemshopError(404, "Baixa não encontrada nesta loja.");
      const result = await database.query(`SELECT c.id,c.conclusao,c.quantidade_comprovada AS "quantidadeComprovada",c.evidencia_tipo AS "evidenciaTipo",
        c.evidencia_referencia AS "evidenciaReferencia",c.justificativa,c.status_anterior AS "statusAnterior",c.status_final AS "statusFinal",
        c.criado_em AS "criadoEm",c.usuario_id AS "usuarioId",u.nome AS responsavel FROM conferencias_baixa c JOIN usuarios_app u ON u.id=c.usuario_id
        WHERE c.baixa_id=$1 AND c.loja_id=$2 ORDER BY c.id DESC LIMIT 50`, [baixaId, auth.lojaId]);
      return { items: result.rows.map(row => ({ ...row, criadoEm: new Date(row.criadoEm).toISOString() })) };
    },
    async resolve(auth: AuthContext, baixaId: number, key: string, input: ConferenceInput) {
      const fingerprint = hash({ baixaId, usuarioId: auth.usuarioId, input });
      return operationTransaction(database, storeId, auth, async client => {
        const result = await client.query(`SELECT id,produto_id,variant_id,quantidade_baixada,status_sincronizacao FROM baixas_estoque
          WHERE id=$1 AND loja_id=$2 FOR UPDATE`, [baixaId, auth.lojaId]);
        if (result.rows.length !== 1) throw new NuvemshopError(404, "Baixa não encontrada nesta loja.");
        const operation = result.rows[0];
        const duplicate = await client.query("SELECT id,conteudo_hash,status_final FROM conferencias_baixa WHERE loja_id=$1 AND requisicao_id=$2", [auth.lojaId, key]);
        if (duplicate.rowCount) {
          if (duplicate.rows[0].conteudo_hash !== fingerprint) throw new NuvemshopError(409, "Chave já usada em outra conferência.");
          return { id: duplicate.rows[0].id, status: duplicate.rows[0].status_final, repetida: true };
        }
        if (!["incerta", "em_processamento", "pendente"].includes(operation.status_sincronizacao)) throw new NuvemshopError(409, "A baixa não está pendente de conferência.");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1::int,hashtext($2)) AS locked", [auth.lojaId, operation.variant_id]);
        if (!lock.rows[0]?.locked) throw new NuvemshopError(409, "Há uma execução em curso. Não conclua a conferência enquanto ela estiver ativa.");
        const quantity = input.quantidadeComprovada, total = operation.quantidade_baixada;
        if ((input.conclusao === "integral" && quantity !== total) || (input.conclusao === "nao_aplicada" && quantity !== 0)
          || (input.conclusao === "parcial" && (quantity === null || quantity <= 0 || quantity >= total))) throw new NuvemshopError(400, "Quantidade comprovada incompatível com a conclusão.");
        const status = input.conclusao === "integral" ? "sincronizada" : input.conclusao === "nao_aplicada" ? "rejeitada"
          : input.conclusao === "parcial" ? "conferida_parcial" : operation.status_sincronizacao;
        const saved = await client.query(`INSERT INTO conferencias_baixa(loja_id,baixa_id,usuario_id,requisicao_id,conteudo_hash,conclusao,quantidade_comprovada,
          evidencia_tipo,evidencia_referencia,justificativa,status_anterior,status_final) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT(loja_id,requisicao_id) DO NOTHING RETURNING id`, [auth.lojaId, baixaId, auth.usuarioId, key, fingerprint, input.conclusao, quantity,
          input.evidenciaTipo, input.evidenciaReferencia, input.justificativa, operation.status_sincronizacao, status]);
        if (saved.rows.length !== 1) throw new NuvemshopError(409, "Chave concorrente. Consulte a conferência antes de repetir.");
        const updated = await client.query("UPDATE baixas_estoque SET status_sincronizacao=$3 WHERE id=$1 AND loja_id=$2 AND status_sincronizacao=$4", [baixaId, auth.lojaId, status, operation.status_sincronizacao]);
        if (updated.rowCount !== 1) throw new NuvemshopError(409, "Estado alterado. Nenhuma conclusão foi confirmada.");
        return { id: saved.rows[0].id, status, repetida: false };
      });
    },
  };
}
export type ConferenceRepository = ReturnType<typeof createConferenceRepository>;
export function createConferenceRouter(secret: string, repository?: ConferenceRepository) {
  const router = Router({ mergeParams: true }); router.use(createSessionService(secret).authenticate);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.all("/", async (req, res) => {
    if (!repository) { res.status(503).json({ message: "Conferências ainda não habilitadas. Procure a administração." }); return; }
    try {
      const rawId = (req.params as Record<string, string>).id, baixaId = Number(rawId);
      if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(baixaId) || baixaId > 2147483647 || Object.keys(req.query).length) throw new NuvemshopError(400, "ID ou parâmetros inválidos.");
      const auth = res.locals.auth as AuthContext;
      if (req.method === "GET") res.json(await repository.list(auth, baixaId));
      else if (req.method === "POST") res.json(await repository.resolve(auth, baixaId, uuid(req.get("Idempotency-Key")), validateConference(req.body)));
      else res.status(405).json({ message: "Método não permitido." });
    } catch (error) { res.status(error instanceof NuvemshopError ? error.status : 503).json({ message: error instanceof NuvemshopError ? error.message : "Conferência não confirmada. Consulte o mesmo registro." }); }
  });
  return router;
}
