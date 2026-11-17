import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { it } from "node:test";
import { compare, getRounds } from "bcryptjs";
import type { Pool } from "pg";
import { createInitialUser, readHiddenPassword } from "../src/scripts/create-initial-user.js";

const senha = randomBytes(20).toString("hex");
const input = { nome: " Ana ", email: " ANA@EXAMPLE.TEST ", senha, expectedStoreId: "67890" };

function database(options: { stores?: unknown[]; duplicate?: boolean; uniqueFailure?: boolean;
  failure?: { query: string; error: unknown } } = {}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  let released = false;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (options.failure && sql.startsWith(options.failure.query)) throw options.failure.error;
      if (sql.startsWith("SELECT id, nuvemshop_store_id")) return {
        rows: options.stores ?? [{ id: 10, nuvemshop_store_id: "67890", conectada: true }],
      };
      if (sql.startsWith("SELECT id FROM usuarios_app")) return { rows: options.duplicate ? [{ id: 1 }] : [] };
      if (sql.startsWith("INSERT INTO usuarios_app")) {
        if (options.uniqueFailure) throw Object.assign(new Error("erro-sensivel"), { code: "23505" });
        return { rows: [{ id: 42 }] };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { pool: { async connect() { return client; } } as unknown as Pool, queries, released: () => released };
}

it("cria usuário com loja_id, normaliza o e-mail e usa bcrypt com custo 10", async () => {
  const db = database();
  const result = await createInitialUser(db.pool, input);
  assert.deepEqual(result, { usuarioId: 42, lojaId: 10 });
  const insert = db.queries.find((entry) => entry.sql.startsWith("INSERT INTO usuarios_app"))!;
  assert.deepEqual(insert.params.slice(0, 3), [10, "Ana", "ana@example.test"]);
  assert.equal(await compare(senha, insert.params[3] as string), true);
  assert.equal(getRounds(insert.params[3] as string), 10);
  assert.equal(db.queries.filter((entry) => entry.sql.startsWith("INSERT")).length, 1);
  assert.ok(db.queries.every((entry) => !entry.sql.includes("usuarios_lojas")));
  assert.equal(db.queries[0].sql, "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.equal(db.queries.at(-1)!.sql, "COMMIT");
  assert.ok(db.queries.every((entry) => !/SELECT.*senha_hash/i.test(entry.sql)));
  assert.equal(db.released(), true);
});

it("recusa e-mail duplicado sem inserir nem atualizar usuários", async () => {
  const db = database({ duplicate: true });
  await assert.rejects(createInitialUser(db.pool, input), /E-mail já cadastrado/);
  assert.ok(db.queries.every((entry) => !/^(INSERT|UPDATE|DELETE)/.test(entry.sql)));
  assert.equal(db.queries.at(-1)!.sql, "ROLLBACK");
  assert.equal(db.released(), true);
});

it("recusa loja ausente, ambígua, sem conexão ou diferente da configurada", async () => {
  for (const stores of [[], [{ id: 10, conectada: false }], [{ id: 10 }, { id: 20 }],
    [{ id: 10, nuvemshop_store_id: "99999", conectada: true }]]) {
    const db = database({ stores });
    await assert.rejects(createInitialUser(db.pool, input));
    assert.ok(db.queries.every((entry) => !entry.sql.startsWith("INSERT")));
    assert.equal(db.queries.at(-1)!.sql, "ROLLBACK");
  }
});

it("desfaz a transação se o insert falhar e não expõe erros internos", async () => {
  for (const options of [{ failure: { query: "INSERT INTO usuarios_app", error: new Error("erro-sensivel") } }, { uniqueFailure: true }]) {
    const db = database(options);
    await assert.rejects(createInitialUser(db.pool, input), (error: Error) => {
      assert.ok(!error.message.includes("erro-sensivel"));
      assert.ok(!error.message.includes(senha));
      return true;
    });
    assert.equal(db.queries.at(-1)!.sql, "ROLLBACK");
    assert.ok(!db.queries.some((entry) => entry.sql === "COMMIT"));
    assert.equal(db.released(), true);
  }
});

it("valida campos e limite de senha antes de abrir conexão", async () => {
  for (const change of [{ nome: " " }, { email: "invalido" }, { senha: "" }, { senha: randomBytes(40).toString("hex") }]) {
    const db = database();
    await assert.rejects(createInitialUser(db.pool, { ...input, ...change }), /Informe nome/);
    assert.equal(db.queries.length, 0);
  }
});

it("identifica a etapa e códigos conhecidos sem expor mensagens, detalhes, senha ou hash", async () => {
  for (const [query, code, column, expected] of [
    ["SELECT id, nuvemshop_store_id", "42703", "access_token", /consulta da loja.*Coluna inexistente/],
    ["SELECT id FROM usuarios_app", "42501", undefined, /verificação do e-mail.*Permissão negada/],
    ["INSERT INTO usuarios_app", "23502", "nome", /criação do usuário.*Coluna: nome/],
    ["SELECT id FROM usuarios_app", "42P01", undefined, /verificação do e-mail.*Tabela inexistente/],
    ["COMMIT", "ECONNRESET", undefined, /confirmação da transação.*Verifique se a conta foi criada/],
  ] as const) {
    const error = Object.assign(new Error(senha), { code, column, detail: senha, query: senha });
    const db = database({ failure: { query, error } });
    await assert.rejects(createInitialUser(db.pool, input), (caught: Error) => {
      assert.match(caught.message, expected);
      assert.ok(!caught.message.includes(senha));
      const hashValue = db.queries.find((entry) => entry.sql.startsWith("INSERT INTO usuarios_app"))?.params[3];
      if (typeof hashValue === "string") assert.ok(!caught.message.includes(hashValue));
      return true;
    });
    assert.equal(db.released(), true);
  }
});

it("não imprime códigos ou nomes de coluna desconhecidos e trata erro de conexão com segurança", async () => {
  const db = database({ failure: { query: "INSERT INTO usuarios_app", error: { code: senha, column: senha, message: senha } } });
  await assert.rejects(createInitialUser(db.pool, input), (error: Error) => {
    assert.ok(!error.message.includes(senha));
    assert.match(error.message, /Erro não identificado/);
    return true;
  });
  const pool = { async connect() { throw Object.assign(new Error(senha), { code: "28P01" }); } } as unknown as Pool;
  await assert.rejects(createInitialUser(pool, input), (error: Error) => {
    assert.match(error.message, /etapa de conexão.*Falha na autenticação.*28P01/);
    assert.ok(!error.message.includes(senha));
    return true;
  });
});

function terminal() {
  const source = new PassThrough();
  let raw = false;
  const hiddenInput = Object.assign(source, {
    isTTY: true, isRaw: false,
    setRawMode(value: boolean) { raw = value; return source; },
  }) as unknown as typeof process.stdin;
  const destination = new PassThrough();
  const output = Object.assign(destination, { isTTY: true }) as unknown as typeof process.stdout;
  let printed = "";
  destination.on("data", (chunk) => { printed += chunk.toString(); });
  return { hiddenInput, output, printed: () => printed, raw: () => raw };
}

it("oculta a senha, aceita correção e restaura o terminal ao concluir", async () => {
  const tty = terminal();
  const password = readHiddenPassword("Senha: ", tty.hiddenInput, tty.output);
  for (const character of Array.from(senha)) tty.hiddenInput.emit("keypress", character, {});
  tty.hiddenInput.emit("keypress", "", { name: "backspace" });
  tty.hiddenInput.emit("keypress", senha.at(-1), {});
  tty.hiddenInput.emit("keypress", "", { name: "return" });
  assert.ok(await password === senha);
  assert.equal(tty.printed(), "Senha: \n");
  assert.equal(tty.raw(), false);
  assert.equal(tty.hiddenInput.listenerCount("keypress"), 0);
});

it("cancela com Ctrl+C sem imprimir a senha e restaura o terminal", async () => {
  const tty = terminal();
  const password = readHiddenPassword("Senha: ", tty.hiddenInput, tty.output);
  tty.hiddenInput.emit("keypress", senha, {});
  tty.hiddenInput.emit("keypress", "", { ctrl: true, name: "c" });
  await assert.rejects(password, /cancelado/);
  assert.equal(tty.printed(), "Senha: \n");
  assert.equal(tty.raw(), false);
});
