import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { it } from "node:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { vendasExternas, itensVendaExterna, movimentosFinanceirosVenda } from "../src/db/schema.js";
import { createSalesRepository } from "../src/sales/repository.js";
import { hash, validateSale, type Sale } from "../src/sales/domain.js";
import { inputBody, key } from "./sales-fixture.js";

function fixture() {
  const input = validateSale(inputBody), queries: { text: string; values: unknown[] }[] = [];
  const sale: Sale = { id: 1, usuarioId: 1, requisicaoId: key, conteudoHash: hash(input), canal: input.canal, formaPagamento: input.formaPagamento,
    moeda: input.moeda, vendidaEm: input.vendidaEm, situacao: "confirmada", subtotal: input.subtotal, descontosItens: input.descontosItens, descontoVenda: input.descontoVenda,
    total: input.total, valorRecebido: input.valorRecebido, valorEstornado: "0.00", criadaEm: input.vendidaEm,
    itens: input.itens.map((item, i) => ({ ...item, id: i + 1, nomeProduto: "Luva", nomeVariante: String(i), sku: null, baixaId: null, estoque: "nao_solicitada" })), movimentos: [] };
  const state = { conflict: false, pending: false, rowCount: 1, fail: "", financialHash: "", locked: true, access: true, saleFound: true };
  const events = new EventEmitter();
  async function query(text: string, values: unknown[] = []) {
    queries.push({ text, values });
    if (state.fail && text.startsWith(state.fail)) throw new Error("erro-interno");
    if (text.includes("pg_try_advisory")) return { rows: [{ locked: state.locked }] };
    if (text.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
    if (text.includes("FROM usuarios_app")) return { rows: state.access ? [{ id: 10, nuvemshopStoreId: "123", accessToken: "token-ficticio" }] : [] };
    if (text.startsWith("INSERT INTO vendas_externas")) return { rows: state.conflict ? [] : [{ id: 1 }] };
    if (text.startsWith("SELECT id, conteudo_hash")) return { rows: [{ id: 1, conteudo_hash: sale.conteudoHash, usuario_id: 1 }] };
    if (text.startsWith("SELECT v.id,")) return { rows: state.saleFound ? [{ ...sale }] : [] };
    if (text.includes("FROM itens_venda_externa i LEFT JOIN")) return { rows: sale.itens.map(item => ({ ...item })) };
    if (text.startsWith("SELECT conteudo_hash FROM movimentos")) return { rows: state.financialHash ? [{ conteudo_hash: state.financialHash }] : [] };
    if (text.includes("FROM movimentos_financeiros_venda WHERE")) return { rows: [] };
    if (text.includes("FROM baixas_estoque WHERE")) return { rows: state.pending ? [{ id: 99 }] : [] };
    if (text.startsWith("INSERT INTO baixas_estoque")) return { rows: [{ id: 7 }] };
    if (text.startsWith("UPDATE")) return { rows: [], rowCount: state.rowCount };
    if (text.includes("AT TIME ZONE")) return { rows: [{ inicio: "2026-11-01T03:00:00Z", fim: "2026-12-01T03:00:00Z" }] };
    if (text.startsWith("WITH comercial")) return { rows: [{ moeda: "BRL", canal: "WhatsApp", vendas: "1", pagamentosPendentes: "1", valorVendido: "50.00", recebimentos: "5.00", estornos: "10.00", recebidoLiquido: "-5.00" }] };
    if (text.includes("AS pendentes")) return { rows: [{ pendentes: "2", incertas: "1" }] };
    return { rows: [] };
  }
  const client = { query, on: events.on.bind(events), removeListener: events.removeListener.bind(events), release() {} };
  const pool = { query, async connect() { return client; } } as unknown as Pool;
  return { repository: createSalesRepository(pool, pool, "123"), pool, sale, input, state, queries };
}
const auth = { usuarioId: 1, lojaId: 10 };

it("venda e itens usam transação e chave única, sem escrever nas tabelas originais ou enviar estoque", async () => {
  const f = fixture(); await f.repository.create(auth, key, hash(f.input), f.input, f.sale.itens);
  assert.equal(f.queries[0].text, "BEGIN"); assert.equal(f.queries.at(-1)!.text, "COMMIT");
  assert.match(f.queries.find(query => query.text.startsWith("INSERT INTO vendas_externas"))!.text, /ON CONFLICT \(loja_id, requisicao_id\) DO NOTHING/);
  assert.equal(f.queries.filter(query => query.text.startsWith("INSERT INTO itens_venda_externa")).length, 2);
  assert.ok(!f.queries.some(query => /INSERT INTO baixas_estoque|UPDATE lojas|ALTER TABLE/.test(query.text)));
});
it("falha em item desfaz a criação local e não confirma aplicação parcial", async () => {
  const f = fixture(); f.state.fail = "INSERT INTO itens_venda_externa";
  await assert.rejects(f.repository.create(auth, key, hash(f.input), f.input, f.sale.itens));
  assert.equal(f.queries.at(-1)!.text, "ROLLBACK"); assert.ok(!f.queries.some(query => query.text === "COMMIT"));
});
it("outra instância respeita a chave persistente e rejeita reaproveitamento com dados diferentes", async () => {
  const f = fixture(); f.state.conflict = true;
  const restarted = createSalesRepository(f.pool, f.pool, "123");
  await restarted.create(auth, key, hash(f.input), f.input, f.sale.itens);
  assert.ok(!f.queries.some(query => query.text.startsWith("INSERT INTO itens_venda_externa")));
  await assert.rejects(restarted.create(auth, key, "outro-hash", f.input, f.sale.itens), { status: 409 });
});
it("preparação vincula baixa original em transação com lock, sem substituir dados ou criar outra pendência", async () => {
  const f = fixture(); assert.equal(await f.repository.prepareItem(auth, 1, 1), 7);
  const texts = f.queries.map(query => query.text);
  assert.ok(texts.some(text => text.includes("FOR UPDATE"))); assert.ok(texts.some(text => text.includes("pg_try_advisory_xact_lock($1::int")));
  assert.ok(texts.findIndex(text => text.startsWith("UPDATE itens_venda_externa")) < texts.indexOf("COMMIT"));
  f.queries.length = 0; f.state.pending = true;
  await assert.rejects(f.repository.prepareItem(auth, 1, 1), { status: 409 });
  assert.ok(!f.queries.some(query => query.text.startsWith("INSERT INTO baixas_estoque")));
});
it("movimento repetido não é inserido; atualização financeira exige lock de linha e comparação de estado", async () => {
  const f = fixture(), event = { tipo: "recebimento" as const, valor: "5.00", formaPagamento: "Pix", ocorridoEm: "2026-11-10T12:00:00.000Z" };
  await f.repository.financial(auth, 1, key, event);
  assert.ok(f.queries.some(query => query.text.includes("FOR UPDATE")));
  assert.match(f.queries.find(query => query.text.startsWith("UPDATE vendas_externas"))!.text, /valor_recebido=\$5 AND valor_estornado=\$6/);
  f.queries.length = 0; f.state.financialHash = hash(event);
  await f.repository.financial(auth, 1, key, event);
  assert.ok(!f.queries.some(query => query.text.startsWith("INSERT INTO movimentos")));
});
it("falha na atualização dos acumulados desfaz o movimento inserido na mesma transação", async () => {
  for (const failure of ["sql", "conditional"]) {
    const f = fixture();
    if (failure === "sql") f.state.fail = "UPDATE vendas_externas"; else f.state.rowCount = 0;
    await assert.rejects(f.repository.financial(auth, 1, key, { tipo: "recebimento", valor: "5.00", formaPagamento: "Pix", ocorridoEm: "2026-11-10T12:00:00Z" }));
    const texts = f.queries.map(query => query.text);
    const insert = texts.findIndex(text => text.startsWith("INSERT INTO movimentos"));
    assert.ok(texts.indexOf("BEGIN") < insert);
    assert.ok(texts.findIndex(text => text.includes("FOR UPDATE")) < insert);
    assert.equal(texts[texts.indexOf("ROLLBACK") - 1].startsWith("UPDATE vendas_externas"), true);
    assert.ok(!texts.includes("COMMIT"));
  }
});
it("recebimento após estorno usa saldo líquido; cancelada permite estorno e recuperação, não novo recebimento", async () => {
  const f = fixture(); f.sale.valorRecebido = "50.00"; f.sale.valorEstornado = "10.00";
  const event = { tipo: "recebimento" as const, valor: "10.00", formaPagamento: "Pix", ocorridoEm: "2026-11-10T12:00:00Z" };
  await f.repository.financial(auth, 1, key, event);
  assert.deepEqual(f.queries.find(query => query.text.startsWith("UPDATE vendas_externas"))!.values, [1, 10, "60.00", "10.00", "50.00", "10.00"]);
  await assert.rejects(f.repository.financial(auth, 1, key, { ...event, valor: "10.01" }), { status: 400 });
  f.sale.situacao = "cancelada"; f.queries.length = 0;
  await assert.rejects(f.repository.financial(auth, 1, key, event), { status: 400 });
  assert.ok(!f.queries.some(query => query.text.startsWith("INSERT")));
  f.state.financialHash = hash(event);
  await f.repository.financial(auth, 1, key, event);
  assert.ok(!f.queries.some(query => query.text.startsWith("INSERT")));
  f.state.financialHash = "";
  await f.repository.financial(auth, 1, key, { ...event, tipo: "estorno", valor: "40.00" });
  await assert.rejects(f.repository.financial(auth, 1, key, { ...event, tipo: "estorno", valor: "40.01" }), { status: 400 });
});
it("consulta, criação e alteração verificam usuário/loja; outra loja ou autor não obtém escrita", async () => {
  const f = fixture();
  f.state.access = false;
  await assert.rejects(f.repository.create(auth, key, hash(f.input), f.input, f.sale.itens), { status: 403 });
  assert.ok(!f.queries.some(query => query.text.startsWith("INSERT")));
  const access = f.queries.find(query => query.text.includes("FROM usuarios_app"))!;
  assert.match(access.text, /JOIN lojas l ON l.id = u.loja_id/); assert.deepEqual(access.values, [1, 10]);
  f.state.access = true; f.state.saleFound = false;
  await assert.rejects(f.repository.get(auth, 1), { status: 404 });
  const read = f.queries.find(query => query.text.startsWith("SELECT v.id,"))!;
  assert.match(read.text, /v.id = \$1 AND v.loja_id = \$2/); assert.deepEqual(read.values, [1, 10]);
  f.state.saleFound = true; f.sale.usuarioId = 2; f.queries.length = 0;
  await assert.rejects(f.repository.financial(auth, 1, key, { tipo: "recebimento", valor: "1.00", formaPagamento: "Pix", ocorridoEm: "2026-11-10T12:00:00Z" }), { status: 403 });
  assert.ok(!f.queries.some(query => /^(INSERT|UPDATE)/.test(query.text)));
});
it("indicadores mensais usam fuso no PostgreSQL, datas distintas e não duplicam totais por item", async () => {
  const f = fixture(); const result = await f.repository.summary(auth, "2026-11");
  assert.equal(result.inicio, "2026-11-01T03:00:00.000Z"); assert.equal(result.totais[0].recebidoLiquido, "-5.00");
  const query = f.queries.find(query => query.text.startsWith("WITH comercial"))!;
  assert.match(query.text, /vendida_em >= \$2/); assert.match(query.text, /m.ocorrido_em >= \$2/);
  assert.match(query.text, /situacao = 'confirmada'/); assert.ok(!query.text.includes("itens_venda_externa"));
  assert.match(query.text, /ELSE -m.valor/);
  await assert.rejects(f.repository.period("2026-13"), { status: 400 });
});
it("migração é incremental, sem conversão de baixas antigas, e mantém RLS nos novos objetos", () => {
  const sql = readFileSync(new URL("../sql/20261122-external-sales.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("BEGIN;") && sql.trim().endsWith("COMMIT;"));
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 3);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 3);
  assert.ok(!/ALTER TABLE public\.(lojas|usuarios_app|acessos_permitidos|baixas_estoque)\b|DROP |INSERT INTO|UPDATE /i.test(sql));
  assert.ok(!sql.includes("numeric(18,2)")); assert.match(sql, /UNIQUE \(loja_id, requisicao_id\)/);
  const monetaryColumns = sql.split("\n").filter(line => /^\s+\w+ numeric NOT NULL/.test(line));
  assert.equal(monetaryColumns.length, 10);
  for (const line of monetaryColumns) {
    assert.match(line, /<> 'NaN'::numeric/); assert.match(line, /9999999999999999\.99/); assert.match(line, /scale\(\w+\) <= 2/);
  }
});
it("CHECKs e tipos monetários do SQL correspondem ao Drizzle sem arredondamento por typmod", () => {
  const sql = readFileSync(new URL("../sql/20261122-external-sales.sql", import.meta.url), "utf8"), dialect = new PgDialect();
  const normalize = (text: string) => text.replace(/"\w+"\."(\w+)"/g, "$1").replace(/\s+/g, " ").trim();
  for (const table of [vendasExternas, itensVendaExterna, movimentosFinanceirosVenda]) {
    const config = getTableConfig(table), body = sql.match(new RegExp(`CREATE TABLE public\\.${config.name} \\(([\\s\\S]*?)\\n\\);`))![1];
    const checks = new Map<string, string>();
    for (const line of body.split("\n")) {
      const expression = line.trim().match(/CHECK \((.*)\),?$/);
      if (!expression) continue;
      const name = line.trim().match(/^CONSTRAINT (\w+) CHECK/)?.[1] ?? `${config.name}_${line.trim().split(" ")[0]}_check`;
      checks.set(name, normalize(expression[1]));
    }
    assert.equal(checks.size, config.checks.length);
    for (const check of config.checks) assert.equal(normalize(dialect.sqlToQuery(check.value).sql), checks.get(check.name), check.name);
    for (const column of config.columns.filter(column => column.dataType === "string" && column.columnType === "PgNumeric")) assert.equal(column.getSQLType(), "numeric");
  }
});
