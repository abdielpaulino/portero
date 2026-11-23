import { createHash, randomBytes } from "node:crypto";
import { hash, truncates } from "bcryptjs";
import { Router } from "express";
import type { Pool } from "pg";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import { object } from "../sales/domain.js";
import { operationTransaction } from "../operations/database.js";

export function invitationHash(secret: unknown) {
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw new NuvemshopError(410, "Convite inválido, expirado ou já utilizado. Solicite outro à administração.");
  return createHash("sha256").update(secret).digest("hex");
}
export function invitationEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new NuvemshopError(400, "Informe um e-mail válido.");
  return email;
}
export function createInvitationRepository(database: Pool, storeId: string) {
  const invalid = () => new NuvemshopError(410, "Convite inválido, expirado ou já utilizado. Se você já criou a conta, tente entrar.");
  return {
    async issue(emailValue: string, hours = 24) {
      const email = invitationEmail(emailValue);
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new NuvemshopError(400, "Validade do convite deve ser de 1 a 168 horas.");
      const secret = randomBytes(32).toString("hex"), fingerprint = invitationHash(secret);
      const result = await operationTransaction(database, storeId, undefined, async (client, store) => {
        await client.query("SELECT id FROM lojas WHERE id=$1 FOR UPDATE", [store.id]);
        const existing = await client.query("SELECT id FROM usuarios_app WHERE lower(btrim(email))=$1 LIMIT 1", [email]);
        if (existing.rowCount) throw new NuvemshopError(409, "E-mail já cadastrado. Nenhuma conta foi alterada.");
        await client.query("UPDATE convites_conta SET revogado_em=now() WHERE loja_id=$1 AND email=$2 AND usado_em IS NULL AND revogado_em IS NULL", [store.id, email]);
        return (await client.query(`INSERT INTO convites_conta(loja_id,email,segredo_hash,expira_em)
          VALUES($1,$2,$3,now()+$4::int*interval '1 hour') RETURNING expira_em`, [store.id, email, fingerprint, hours])).rows[0];
      });
      // A credencial é entregue somente ao comando administrativo; o banco guarda o hash.
      return { secret, expiraEm: new Date(result.expira_em).toISOString() };
    },
    async inspect(secret: unknown) {
      const fingerprint = invitationHash(secret);
      return operationTransaction(database, storeId, undefined, async (client, store) => {
        const found = await client.query(`SELECT email FROM convites_conta WHERE segredo_hash=$1 AND loja_id=$2
          AND usado_em IS NULL AND revogado_em IS NULL AND expira_em>clock_timestamp()`, [fingerprint, store.id]);
        if (found.rows.length !== 1) throw invalid();
        return { email: found.rows[0].email };
      });
    },
    async activate(secret: unknown, nome: unknown, password: unknown, confirmation: unknown) {
      const fingerprint = invitationHash(secret);
      if (typeof nome !== "string" || nome.trim().length < 2 || nome.trim().length > 100 || /[\x00-\x1f]/.test(nome)
        || typeof password !== "string" || password.length < 12 || truncates(password) || password !== confirmation)
        throw new NuvemshopError(400, "Informe nome e uma senha de pelo menos 12 caracteres e até 72 bytes, com confirmação igual.");
      // Convite inválido não provoca trabalho de hash de senha.
      await this.inspect(secret);
      const senhaHash = await hash(password, 12);
      return operationTransaction(database, storeId, undefined, async (client, store) => {
        await client.query("SELECT id FROM lojas WHERE id=$1 FOR UPDATE", [store.id]);
        const found = await client.query(`SELECT id,email FROM convites_conta WHERE segredo_hash=$1 AND loja_id=$2
          AND usado_em IS NULL AND revogado_em IS NULL AND expira_em>clock_timestamp() FOR UPDATE`, [fingerprint, store.id]);
        if (found.rows.length !== 1) throw invalid();
        const invite = found.rows[0];
        const duplicate = await client.query("SELECT id FROM usuarios_app WHERE lower(btrim(email))=$1 LIMIT 1", [invite.email]);
        if (duplicate.rowCount) throw new NuvemshopError(409, "Conta já existente. Entre ou procure a administração; nenhuma senha foi alterada.");
        const user = await client.query("INSERT INTO usuarios_app(loja_id,nome,email,senha_hash) VALUES($1,$2,$3,$4) RETURNING id", [store.id, nome.trim(), invite.email, senhaHash]);
        const consumed = await client.query("UPDATE convites_conta SET usado_em=clock_timestamp(),usuario_id=$2 WHERE id=$1 AND usado_em IS NULL AND revogado_em IS NULL AND expira_em>clock_timestamp()", [invite.id, user.rows[0].id]);
        if (consumed.rowCount !== 1) throw invalid();
        return { message: "Conta criada. Entre com seu e-mail e senha." };
      });
    },
  };
}
export type InvitationRepository = ReturnType<typeof createInvitationRepository>;
export function createInvitationRouter(repository?: InvitationRepository) {
  const router = Router(); router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });
  for (const action of ["inspect", "activate"] as const) router.post(`/${action}`, async (req, res) => {
    if (!repository) { res.status(503).json({ message: "Ativação por convite ainda não habilitada. Procure a administração." }); return; }
    try {
      if (Object.keys(req.query).length) throw new NuvemshopError(400, "Parâmetros não permitidos.");
      const body = object(req.body, action === "inspect" ? ["codigo"] : ["codigo", "nome", "password", "confirmation"]);
      const result = action === "inspect" ? await repository.inspect(body.codigo) : await repository.activate(body.codigo, body.nome, body.password, body.confirmation);
      res.status(action === "activate" ? 201 : 200).json(result);
    } catch (error) {
      res.status(error instanceof NuvemshopError ? error.status : 503).json({ message: error instanceof NuvemshopError ? error.message : "Ativação não confirmada. Antes de repetir, tente entrar ou procure a administração." });
    }
  });
  return router;
}
