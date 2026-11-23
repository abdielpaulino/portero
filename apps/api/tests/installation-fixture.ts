import type { Pool } from "pg";
export type TestStore = { id: number; nuvemshop_store_id: string; access_token: string; status: string; generation: string; scope?: string | null; nome_loja?: string };
export const prepared = (status = "instalacao_inicializada"): TestStore => ({ id: 8, nuvemshop_store_id: "123", access_token: "", status, generation: "1730000000.123456" });
// Banco compartilhado simulado; a implementação real usa transações e locks PostgreSQL.
export function pgFixture(initial: TestStore[] = [prepared()], options: { fail?: string; loseCommit?: boolean; pausedUpdate?: Promise<void>; onUpdate?: () => void } = {}) {
  let rows = structuredClone(initial), owner: symbol | undefined, fail = options.fail;
  const queries: { text: string; values?: unknown[] }[] = [];
  const resultRows = (values: TestStore[]) => values.map(row => ({ ...row, conectada: !!row.access_token.trim() }));
  const pool = {
    async query(text: string) { queries.push({ text }); return { rows: resultRows(rows) }; },
    async connect() {
      const token = Symbol();
      let local = structuredClone(rows), transaction = false;
      return {
        async query(text: string, values?: unknown[]) {
          queries.push({ text, values });
          if (fail && text.startsWith(fail)) throw new Error("falha-simulada-sensivel");
          if (text === "BEGIN") { transaction = true; local = structuredClone(rows); }
          if (text.includes("pg_try_advisory_xact_lock")) {
            if (!owner) { owner = token; local = structuredClone(rows); }
            return { rows: [{ locked: owner === token }] };
          }
          if (text.startsWith("SELECT id")) return { rows: resultRows(local) };
          if (text.startsWith("SELECT EXISTS")) return { rows: [{ possui_dados: rows.length > 0 }] };
          if (text.startsWith("INSERT INTO lojas")) {
            local.push({ ...prepared(), id: 9, nuvemshop_store_id: String(values?.[0]), status: String(values?.[1]) });
            return { rows: [{ id: 9 }], rowCount: 1 };
          }
          if (text.startsWith("UPDATE lojas")) {
            assertOwner();
            options.onUpdate?.();
            if (options.pausedUpdate) await options.pausedUpdate;
            if (text.includes("status = $2 WHERE id")) {
              for (const row of local) if (row.id === values?.[0] && !(values?.[1] === "suspensa" && row.status === "desinstalada")) {
                row.access_token = ""; row.scope = null; row.status = String(values?.[1]);
              }
            } else {
              const row = local.find(row => row.id === values?.[0] && row.status === values?.[1]);
              if (!row) return { rows: [], rowCount: 0 };
              if (text.includes("access_token = $3")) {
                row.access_token = String(values?.[2]); row.scope = String(values?.[3]); row.nome_loja = String(values?.[4]); row.status = "ativa";
              } else row.status = String(values?.[2]);
            }
            return { rows: [], rowCount: 1 };
          }
          if (text.startsWith("DELETE FROM lojas")) { assertOwner(); local = local.filter(row => row.id !== values?.[0]); }
          if (text === "COMMIT") {
            if (transaction && owner === token) rows = structuredClone(local);
            transaction = false; if (owner === token) owner = undefined;
            if (options.loseCommit) throw new Error("resposta de commit perdida");
          }
          if (text === "ROLLBACK") { transaction = false; if (owner === token) owner = undefined; }
          return { rows: [], rowCount: 1 };
          function assertOwner() { if (owner !== token) throw new Error("Mutação sem lock"); }
        },
        release() { if (owner === token) owner = undefined; },
      };
    },
  } as unknown as Pool;
  return { pool, queries, rows: () => structuredClone(rows), failQueries(prefix?: string) { fail = prefix; } };
}
