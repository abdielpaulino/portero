import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

let connectionUrl: URL;
try { connectionUrl = new URL(databaseUrl); } catch { throw new Error("Configure uma DATABASE_URL PostgreSQL válida no backend."); }
if (!["postgres:", "postgresql:"].includes(connectionUrl.protocol)) throw new Error("DATABASE_URL deve usar PostgreSQL.");
if (connectionUrl.port === "6543") throw new Error("Baixas exigem conexão direta ou Session pooler; transaction pooler não é compatível.");
if (process.env.NODE_ENV === "production" && !["require", "verify-ca", "verify-full"].includes(connectionUrl.searchParams.get("sslmode") ?? "")) {
  throw new Error("A conexão de produção exige SSL em DATABASE_URL.");
}

export const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000, allowExitOnIdle: true });
pool.on("error", () => {
  console.error("A conexão ociosa com o banco foi encerrada.");
});

export const webhookPool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 500,
  idleTimeoutMillis: 5_000, statement_timeout: 1_000, query_timeout: 1_100, allowExitOnIdle: true });
webhookPool.on("error", () => {
  console.error("A conexão de webhooks com o banco foi encerrada.");
});

export const db = drizzle(pool, { schema });

// Separa o lock de venda da conexão usada pela baixa; evita espera circular em pool de tamanho um.
export const salesControlPool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000, allowExitOnIdle: true });
salesControlPool.on("error", () => console.error("A conexão de controle comercial foi encerrada."));
