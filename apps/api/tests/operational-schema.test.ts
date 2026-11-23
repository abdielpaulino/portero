import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { convitesConta, conferenciasBaixa, configuracoesLoja, alertasEstoque } from "../src/db/schema.js";

it("extensão operacional é incremental, com RLS e CHECKs equivalentes ao Drizzle", () => {
  const sql = readFileSync(new URL("../sql/20261122-operational-extension.sql", import.meta.url), "utf8"), dialect = new PgDialect();
  assert.ok(sql.includes("BEGIN;") && sql.trim().endsWith("COMMIT;"));
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 4); assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 4);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(lojas|usuarios_app|baixas_estoque|acessos_permitidos)\b|\bDROP\b|\bINSERT\b|\bUPDATE\b/i);
  const normalize = (value: string) => value.replace(/"\w+"\."(\w+)"/g, "$1").replace(/\s+/g, " ").trim();
  for (const table of [convitesConta, conferenciasBaixa, configuracoesLoja, alertasEstoque]) {
    const config = getTableConfig(table), body = sql.match(new RegExp(`CREATE TABLE public\\.${config.name} \\(([\\s\\S]*?)\\n\\);`))![1];
    const checks = new Map<string, string>();
    for (const line of body.split("\n")) {
      const expression = line.trim().match(/CHECK \((.*)\),?$/); if (!expression) continue;
      const name = line.trim().match(/^CONSTRAINT (\w+) CHECK/)?.[1] ?? `${config.name}_${line.trim().split(" ")[0]}_check`;
      checks.set(name, normalize(expression[1]));
    }
    assert.equal(checks.size, config.checks.length, config.name);
    for (const check of config.checks) assert.equal(normalize(dialect.sqlToQuery(check.value).sql), checks.get(check.name), check.name);
    assert.equal(config.enableRLS, true);
  }
});
