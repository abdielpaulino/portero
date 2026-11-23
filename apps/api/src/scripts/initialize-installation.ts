import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { readRuntime } from "../runtime.js";
import { INITIAL_STATUS } from "../nuvemshop/repository.js";

export async function initializeFirstInstallation(database: Pool, storeId: string) {
  if (!/^[1-9]\d*$/.test(storeId)) throw new Error("ID da loja inválido.");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(7144630821938501::bigint) AS locked");
    if (!lock.rows[0]?.locked) throw new Error("Há outra operação em curso. Não inicializar.");
    const existing = await client.query(`SELECT EXISTS (SELECT 1 FROM lojas)
      OR EXISTS (SELECT 1 FROM usuarios_app) OR EXISTS (SELECT 1 FROM acessos_permitidos)
      OR EXISTS (SELECT 1 FROM baixas_estoque) AS possui_dados`);
    if (existing.rows[0]?.possui_dados !== false) throw new Error("A base contém dados ou não pôde ser conferida. Exige análise administrativa.");
    // Preparação explícita, sem token remoto. Nenhum endpoint cria este registro.
    const created = await client.query("INSERT INTO lojas (nuvemshop_store_id, access_token, nome_loja, status) VALUES ($1, '', '', $2) RETURNING id",
      [storeId, INITIAL_STATUS]);
    if (created.rows.length !== 1) throw new Error("Preparação não confirmada.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function main() {
  let database: Pool | undefined;
  try {
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Use um terminal interativo confiável.");
    const index = process.argv.indexOf("--env-file");
    const path = index >= 0 ? process.argv[index + 1] : undefined;
    if (!path || path.startsWith("--")) throw new Error("Selecione o arquivo administrativo com --env-file.");
    const env: Record<string, string> = {};
    if (config({ path: resolve(path), processEnv: env }).error) throw new Error("Não foi possível ler o arquivo administrativo.");
    const runtime = readRuntime(env);
    if (!runtime.nuvemshop?.storeId || !env.DATABASE_URL) throw new Error("Confirme o ID da loja e a configuração administrativa da instalação.");
    const connection = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(connection.protocol) || connection.port === "6543"
      || (runtime.production && !["require", "verify-ca", "verify-full"].includes(connection.searchParams.get("sslmode") ?? ""))) {
      throw new Error("Use PostgreSQL direto ou Session pooler e SSL em produção.");
    }
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      stdout.write("Inicialização exclusiva da primeira instalação. Não usar para perda de estado, restauração ou reinstalação.\n");
      const expected = `PRIMEIRA INSTALACAO ${runtime.nuvemshop.clientId}/${runtime.nuvemshop.storeId}`;
      const confirmed = await terminal.question(`Após conferir o histórico com os responsáveis, digite ${expected}: `);
      if (confirmed !== expected) throw new Error("Inicialização não confirmada.");
    } finally { terminal.close(); }
    database = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
    await initializeFirstInstallation(database, runtime.nuvemshop.storeId);
    stdout.write("Registro local de preparação criado. Nenhuma conexão Nuvemshop, conta ou baixa foi executada.\n");
  } catch {
    console.error("Inicialização não confirmada. Confira o estado e o histórico com a administração antes de repetir; o comando não permite desbloqueio.");
    process.exitCode = 1;
  } finally { await database?.end().catch(() => {}); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
