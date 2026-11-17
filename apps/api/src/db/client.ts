import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10_000 });
pool.on("error", () => {
  console.error("A conexão ociosa com o banco foi encerrada.");
});

export const db = drizzle(pool, { schema });
