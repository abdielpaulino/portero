import { stdin, stdout } from "node:process";
import { emitKeypressEvents, type Key } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { hash, truncates } from "bcryptjs";
import { config } from "dotenv";
import { Pool } from "pg";

class SetupError extends Error {}

function databaseError(error: unknown, stage: string): SetupError {
  if (error instanceof SetupError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const diagnostics: Record<string, string> = {
    "42P01": "Tabela inexistente. Confira lojas e usuarios_app no schema usado pela conexão.",
    "42703": "Coluna inexistente. O schema do banco difere de apps/api/src/db/schema.ts.",
    "42501": "Permissão negada. Confira o usuário da conexão e as permissões ou políticas de acesso das tabelas.",
    "23502": "Uma coluna obrigatória não foi preenchida. Confira os campos obrigatórios e valores padrão no banco.",
    "23503": "Referência de loja ou usuário inválida. Confira as chaves estrangeiras do banco.",
    "23505": "Cadastro duplicado. Nenhum usuário existente foi alterado.",
    "23514": "Uma restrição do banco recusou o cadastro. Confira as regras das tabelas.",
    "40001": "Conflito entre transações. Execute novamente após conferir se a conta já existe.",
    "28P01": "Falha na autenticação do banco. Confira as credenciais de DATABASE_URL localmente.",
    "3D000": "Banco inexistente. Confira o banco definido em DATABASE_URL localmente.",
    "57014": "A consulta excedeu o tempo limite ou foi cancelada.",
    ENOTFOUND: "Servidor do banco não encontrado. Confira o endereço de DATABASE_URL e o DNS localmente.",
    EAI_AGAIN: "Falha temporária de DNS ao localizar o banco.",
    ECONNREFUSED: "Conexão recusada. Confira o servidor, a porta e a disponibilidade do banco.",
    ECONNRESET: "A conexão com o banco foi interrompida.",
    ETIMEDOUT: "A conexão com o banco excedeu o tempo limite.",
    SELF_SIGNED_CERT_IN_CHAIN: "Falha na validação do certificado TLS do banco. Confira a configuração SSL e os certificados.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "O banco apresentou um certificado TLS não confiável. Confira a configuração SSL e os certificados.",
    CERT_HAS_EXPIRED: "O certificado TLS do banco expirou.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "Não foi possível verificar o certificado TLS do banco.",
  };
  // Mensagens e detalhes do pg podem incluir parâmetros sensíveis da consulta.
  const known = typeof code === "string" && Object.hasOwn(diagnostics, code);
  let message = known ? `${diagnostics[code]} Código: ${code}.` : "Erro não identificado. Confira a conexão e o schema do banco.";
  const column = typeof error === "object" && error !== null && "column" in error ? error.column : undefined;
  const columns = ["id", "loja_id", "nome", "email", "senha_hash", "criado_em", "usuario_id", "nuvemshop_store_id", "access_token"];
  if ((code === "23502" || code === "42703") && typeof column === "string" && columns.includes(column)) {
    message += ` Coluna: ${column}.`;
  }
  if (stage === "confirmação da transação") message += " Verifique se a conta foi criada antes de repetir o comando.";
  return new SetupError(`Falha na etapa de ${stage}. ${message}`);
}

type InitialUser = { nome: string; email: string; senha: string; expectedStoreId?: string };

export async function createInitialUser(pool: Pool, input: InitialUser) {
  const nome = input.nome.trim();
  const email = input.email.trim().toLowerCase();
  if (!nome || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !input.senha || truncates(input.senha)) {
    throw new SetupError("Informe nome, e-mail válido e senha de até 72 bytes.");
  }
  const senhaHash = await hash(input.senha, 10);
  const client = await pool.connect().catch((error: unknown) => { throw databaseError(error, "conexão"); });
  let stage = "início da transação";
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    stage = "consulta da loja";
    const stores = await client.query<{ id: number; nuvemshop_store_id: string; conectada: boolean }>(
      "SELECT id, nuvemshop_store_id, length(btrim(access_token)) > 0 AS conectada FROM lojas LIMIT 2",
    );
    if (stores.rows.length !== 1 || !stores.rows[0].conectada) {
      throw new SetupError("O banco deve conter uma única loja Nuvemshop conectada antes do cadastro.");
    }
    const loja = stores.rows[0];
    if (input.expectedStoreId && loja.nuvemshop_store_id !== input.expectedStoreId) {
      throw new SetupError("A loja do banco não corresponde a NUVEMSHOP_DEMO_STORE_ID.");
    }
    stage = "verificação do e-mail";
    const duplicate = await client.query(
      "SELECT id FROM usuarios_app WHERE lower(btrim(email)) = $1 LIMIT 1", [email],
    );
    if (duplicate.rows.length) throw new SetupError("E-mail já cadastrado. Nenhum usuário foi alterado.");
    stage = "criação do usuário";
    const created = await client.query<{ id: number }>(
      "INSERT INTO usuarios_app (loja_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING id",
      [loja.id, nome, email, senhaHash],
    );
    const usuarioId = created.rows[0].id;
    stage = "confirmação da transação";
    await client.query("COMMIT");
    return { usuarioId, lojaId: loja.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw databaseError(error, stage);
  } finally {
    client.release();
  }
}

export function readHiddenPassword(prompt: string, input = stdin, output = stdout): Promise<string> {
  if (!input.isTTY || !output.isTTY) throw new SetupError("Execute em um terminal interativo para ocultar a senha.");
  return new Promise((resolvePassword, reject) => {
    const wasRaw = input.isRaw;
    let password = "";
    emitKeypressEvents(input);
    function finish(error?: SetupError) {
      input.removeListener("keypress", onKey);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolvePassword(password);
      password = "";
    }
    function onKey(text: string | undefined, key: Key) {
      if (key.ctrl && (key.name === "c" || key.name === "d")) finish(new SetupError("Cadastro cancelado."));
      else if (key.name === "return" || key.name === "enter") finish();
      else if (key.name === "backspace") password = Array.from(password).slice(0, -1).join("");
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) password += text;
    }
    output.write(prompt);
    input.setRawMode(true);
    input.on("keypress", onKey);
    input.resume();
  });
}

async function main() {
  let pool: Pool | undefined;
  let senha = "";
  let confirmacao = "";
  try {
    if (!stdin.isTTY || !stdout.isTTY) throw new SetupError("Execute em um terminal interativo, sem redirecionar a entrada ou a saída.");
    // Um ambiente herdado do shell não pode trocar o banco definido no .env da API.
    const env: Record<string, string> = {};
    const loaded = config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), processEnv: env });
    if (loaded.error || !env.DATABASE_URL?.trim()) throw new SetupError("Configure DATABASE_URL em apps/api/.env.");
    if (env.NODE_ENV !== "development") throw new SetupError("Este script é permitido somente com NODE_ENV=development em apps/api/.env.");
    const terminal = createInterface({ input: stdin, output: stdout });
    let nome: string;
    let email: string;
    try {
      nome = await terminal.question("Nome: ");
      email = await terminal.question("E-mail: ");
    } finally {
      terminal.close();
    }
    senha = await readHiddenPassword("Senha (entrada oculta): ");
    confirmacao = await readHiddenPassword("Confirme a senha (entrada oculta): ");
    if (senha !== confirmacao) throw new SetupError("As senhas não coincidem. Nenhuma conta foi criada.");
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
    const result = await createInitialUser(pool, { nome, email, senha, expectedStoreId: env.NUVEMSHOP_DEMO_STORE_ID?.trim() });
    stdout.write(`Conta criada. Usuário ID: ${result.usuarioId}; loja ID: ${result.lojaId}.\n`);
  } catch (error) {
    console.error(error instanceof SetupError ? error.message : "Não foi possível criar a conta. Confira a configuração do banco.");
    process.exitCode = 1;
  } finally {
    senha = "";
    confirmacao = "";
    await pool?.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
