import type { Pool, PoolClient } from "pg";
import type { AuthContext } from "../auth/session.js";
import type { StoreCredentials } from "../nuvemshop/products.js";
import { NuvemshopError } from "../nuvemshop/oauth.js";
import { cents, hash, money, type FinancialEvent, type FinancialInput, type PreparedItem, type Sale, type SaleInput, type SaleItem } from "./domain.js";

type Queryable = Pick<PoolClient, "query">;
export type Period = { periodo: string; fuso: string; inicio: string; fim: string };
export type ExternalSummary = Period & { totais: { moeda: string; canal: string; vendas: number; valorVendido: string; recebimentos: string; estornos: string; recebidoLiquido: string; pagamentosPendentes: number }[]; estoque: { pendentes: number; incertas: number } };
export interface SalesRepository {
  store(auth: AuthContext): Promise<StoreCredentials>;
  period(month: string): Promise<Period>;
  findRequest(auth: AuthContext, key: string): Promise<Sale | null>;
  create(auth: AuthContext, key: string, fingerprint: string, input: SaleInput, items: PreparedItem[]): Promise<Sale>;
  get(auth: AuthContext, id: number): Promise<Sale>;
  list(auth: AuthContext, page: number): Promise<{ items: Sale[]; hasMore: boolean }>;
  summary(auth: AuthContext, month: string): Promise<ExternalSummary>;
  withSale<T>(auth: AuthContext, id: number, work: (sale: Sale) => Promise<T>): Promise<T>;
  prepareItem(auth: AuthContext, saleId: number, itemId: number): Promise<number>;
  financial(auth: AuthContext, id: number, key: string, input: FinancialInput): Promise<Sale>;
  cancel(auth: AuthContext, id: number): Promise<Sale>;
}
const fields = `v.id, v.usuario_id AS "usuarioId", v.requisicao_id AS "requisicaoId", v.conteudo_hash AS "conteudoHash",
 v.canal, v.forma_pagamento AS "formaPagamento", v.moeda, v.vendida_em AS "vendidaEm", v.situacao, v.subtotal,
 v.descontos_itens AS "descontosItens", v.desconto_venda AS "descontoVenda", v.total, v.valor_recebido AS "valorRecebido",
 v.valor_estornado AS "valorEstornado", v.criada_em AS "criadaEm"`;
const iso = (value: unknown) => new Date(value as string | Date).toISOString();
const denied = () => new NuvemshopError(403, "Venda indisponível para esta conta e loja.");

export function createSalesRepository(database: Pool, control: Pool, storeId: string): SalesRepository {
  async function store(auth: AuthContext, client: Queryable = database) {
    const found = await client.query<StoreCredentials>(`SELECT l.id, l.nuvemshop_store_id AS "nuvemshopStoreId", l.access_token AS "accessToken"
      FROM usuarios_app u JOIN lojas l ON l.id = u.loja_id WHERE u.id = $1 AND l.id = $2
      AND l.status IN ('pendente', 'ativa') AND length(btrim(l.access_token)) > 0`, [auth.usuarioId, auth.lojaId]);
    if (found.rows.length !== 1 || found.rows[0].nuvemshopStoreId !== storeId) throw denied();
    return found.rows[0];
  }
  async function load(client: Queryable, auth: AuthContext, id: number): Promise<Sale> {
    const root = await client.query<Sale>(`SELECT ${fields} FROM vendas_externas v WHERE v.id = $1 AND v.loja_id = $2`, [id, auth.lojaId]);
    if (root.rows.length !== 1) throw new NuvemshopError(404, "Venda não encontrada nesta loja.");
    const items = await client.query<SaleItem>(`SELECT i.id, i.produto_id AS "produtoId", i.variante_id AS "varianteId", i.nome_produto AS "nomeProduto",
      i.nome_variante AS "nomeVariante", i.sku, i.quantidade, i.preco_unitario AS "precoUnitario", i.desconto, i.total,
      i.baixa_id AS "baixaId", COALESCE(b.status_sincronizacao, 'nao_solicitada') AS estoque
      FROM itens_venda_externa i LEFT JOIN baixas_estoque b ON b.id = i.baixa_id WHERE i.venda_id = $1 ORDER BY i.id`, [id]);
    const events = await client.query<FinancialEvent>(`SELECT id, usuario_id AS "usuarioId", tipo, valor, forma_pagamento AS "formaPagamento",
      ocorrido_em AS "ocorridoEm", registrado_em AS "registradoEm" FROM movimentos_financeiros_venda WHERE venda_id = $1 ORDER BY ocorrido_em, id`, [id]);
    return { ...root.rows[0], vendidaEm: iso(root.rows[0].vendidaEm), criadaEm: iso(root.rows[0].criadaEm), itens: items.rows,
      movimentos: events.rows.map(event => ({ ...event, ocorridoEm: iso(event.ocorridoEm), registradoEm: iso(event.registradoEm) })) };
  }
  async function transaction<T>(auth: AuthContext, work: (client: PoolClient) => Promise<T>) {
    const client = await database.connect();
    let discard = false;
    const onError = () => { discard = true; };
    client.on("error", onError);
    try {
      await client.query("BEGIN");
      const lock = await client.query("SELECT pg_try_advisory_xact_lock_shared(7144630821938501::bigint) AS locked");
      if (!lock.rows[0]?.locked) throw new NuvemshopError(503, "Instalação em atualização. Consulte a operação antes de continuar.");
      await store(auth, client);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => { discard = true; }); throw error; }
    finally { try { client.release(discard); } finally { client.removeListener("error", onError); } }
  }
  const repository: SalesRepository = {
    store,
    async period(month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "0001-01") throw new NuvemshopError(400, "Período inválido; use AAAA-MM.");
      const result = await database.query(`SELECT $1::date::timestamp AT TIME ZONE 'America/Sao_Paulo' AS inicio,
        ($1::date + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo' AS fim`, [`${month}-01`]);
      return { periodo: month, fuso: "America/Sao_Paulo", inicio: iso(result.rows[0].inicio), fim: iso(result.rows[0].fim) };
    },
    async findRequest(auth, key) {
      await store(auth);
      const result = await database.query("SELECT id FROM vendas_externas WHERE loja_id = $1 AND usuario_id = $2 AND requisicao_id = $3", [auth.lojaId, auth.usuarioId, key]);
      return result.rows.length ? load(database, auth, result.rows[0].id) : null;
    },
    async create(auth, key, fingerprint, input, items) {
      return transaction(auth, async client => {
        const inserted = await client.query(`INSERT INTO vendas_externas (loja_id, usuario_id, requisicao_id, conteudo_hash, canal, forma_pagamento,
          moeda, vendida_em, subtotal, descontos_itens, desconto_venda, total, valor_recebido)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (loja_id, requisicao_id) DO NOTHING RETURNING id`,
        [auth.lojaId, auth.usuarioId, key, fingerprint, input.canal, input.formaPagamento, input.moeda, input.vendidaEm,
          input.subtotal, input.descontosItens, input.descontoVenda, input.total, input.valorRecebido]);
        if (!inserted.rows.length) {
          const existing = await client.query("SELECT id, conteudo_hash, usuario_id FROM vendas_externas WHERE loja_id = $1 AND requisicao_id = $2", [auth.lojaId, key]);
          if (existing.rows[0]?.usuario_id !== auth.usuarioId) throw denied();
          if (existing.rows[0]?.conteudo_hash !== fingerprint) throw new NuvemshopError(409, "A chave já pertence a uma venda com outros dados.");
          return load(client, auth, existing.rows[0].id);
        }
        const id = inserted.rows[0].id;
        for (const item of items) await client.query(`INSERT INTO itens_venda_externa (venda_id, produto_id, variante_id, nome_produto, nome_variante, sku, quantidade, preco_unitario, desconto, total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, item.produtoId, item.varianteId, item.nomeProduto, item.nomeVariante, item.sku, item.quantidade, item.precoUnitario, item.desconto, item.total]);
        if (cents(input.valorRecebido) > 0n) {
          const event: FinancialInput = { tipo: "recebimento", valor: input.valorRecebido, formaPagamento: input.formaPagamento, ocorridoEm: input.recebidoEm! };
          await client.query(`INSERT INTO movimentos_financeiros_venda (venda_id, usuario_id, requisicao_id, conteudo_hash, tipo, valor, forma_pagamento, ocorrido_em)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, auth.usuarioId, key, hash(event), event.tipo, event.valor, event.formaPagamento, event.ocorridoEm]);
        }
        return load(client, auth, id);
      });
    },
    async get(auth, id) { await store(auth); return load(database, auth, id); },
    async list(auth, page) {
      await store(auth);
      const result = await database.query("SELECT id FROM vendas_externas WHERE loja_id = $1 ORDER BY vendida_em DESC, id DESC LIMIT 21 OFFSET $2", [auth.lojaId, (page - 1) * 20]);
      const items: Sale[] = [];
      for (const row of result.rows.slice(0, 20)) items.push(await load(database, auth, row.id));
      return { items, hasMore: result.rows.length > 20 };
    },
    async withSale(auth, id, work) {
      const client = await control.connect();
      let locked = false, discard = false;
      const onError = () => { discard = true; };
      client.on("error", onError);
      try {
        try {
          const result = await client.query("SELECT pg_try_advisory_lock(1372859531::int, $1::int) AS locked", [id]);
          if (typeof result.rows[0]?.locked !== "boolean") throw new Error();
          locked = result.rows[0].locked;
        } catch (error) { discard = true; throw error; }
        if (!locked) throw new NuvemshopError(409, "Venda em processamento. Consulte o mesmo registro.");
        await store(auth, client);
        const sale = await load(client, auth, id);
        if (sale.usuarioId !== auth.usuarioId) throw denied();
        return await work(sale);
      } finally {
        if (locked && !discard) {
          try { const result = await client.query("SELECT pg_advisory_unlock(1372859531::int, $1::int) AS unlocked", [id]); discard = result.rows[0]?.unlocked !== true; }
          catch { discard = true; }
        }
        try { client.release(discard); } finally { client.removeListener("error", onError); }
      }
    },
    async prepareItem(auth, saleId, itemId) {
      return transaction(auth, async client => {
        await client.query("SELECT id FROM vendas_externas WHERE id=$1 AND loja_id=$2 FOR UPDATE", [saleId, auth.lojaId]);
        const sale = await load(client, auth, saleId);
        if (sale.usuarioId !== auth.usuarioId || sale.situacao !== "confirmada") throw denied();
        const item = sale.itens.find(item => item.id === itemId);
        if (!item) throw new NuvemshopError(404, "Item não pertence à venda.");
        if (item.baixaId !== null) return item.baixaId;
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1::int, hashtext($2)) AS locked", [auth.lojaId, item.varianteId]);
        if (!lock.rows[0]?.locked) throw new NuvemshopError(409, "Variante em processamento. Consulte a venda.");
        const pending = await client.query(`SELECT id FROM baixas_estoque WHERE loja_id = $1 AND variant_id = $2
          AND status_sincronizacao NOT IN ('sincronizada','rejeitada') LIMIT 1`, [auth.lojaId, item.varianteId]);
        if (pending.rows.length) throw new NuvemshopError(409, "A variante tem outra operação pendente. A venda permanece registrada.");
        const operation = await client.query(`INSERT INTO baixas_estoque (loja_id,usuario_id,produto_id,variant_id,sku,quantidade_baixada,status_sincronizacao)
          VALUES ($1,$2,$3,$4,$5,$6,'registrada') RETURNING id`, [auth.lojaId, auth.usuarioId, item.produtoId, item.varianteId, item.sku, item.quantidade]);
        if (operation.rows.length !== 1) throw new NuvemshopError(503, "Registro da baixa não confirmado.");
        const linked = await client.query("UPDATE itens_venda_externa SET baixa_id = $3 WHERE id = $1 AND venda_id = $2 AND baixa_id IS NULL", [itemId, saleId, operation.rows[0].id]);
        if (linked.rowCount !== 1) throw new NuvemshopError(409, "Vínculo da baixa não confirmado.");
        return operation.rows[0].id as number;
      });
    },
    async financial(auth, id, key, input) {
      return repository.withSale(auth, id, () => transaction(auth, async client => {
        await client.query("SELECT id FROM vendas_externas WHERE id=$1 AND loja_id=$2 FOR UPDATE", [id, auth.lojaId]);
        const sale = await load(client, auth, id);
        const duplicate = await client.query("SELECT conteudo_hash FROM movimentos_financeiros_venda WHERE venda_id = $1 AND requisicao_id = $2", [id, key]);
        if (duplicate.rows.length) {
          if (duplicate.rows[0].conteudo_hash !== hash(input)) throw new NuvemshopError(409, "A chave já pertence a outro movimento financeiro.");
          return sale;
        }
        if (input.tipo === "recebimento" && sale.situacao === "cancelada") throw new NuvemshopError(400, "Venda cancelada não aceita novo recebimento.");
        // Após estorno, uma venda confirmada pode receber novamente até seu total líquido.
        const received = cents(sale.valorRecebido) + (input.tipo === "recebimento" ? cents(input.valor) : 0n);
        const refunded = cents(sale.valorEstornado) + (input.tipo === "estorno" ? cents(input.valor) : 0n);
        if (received - refunded > cents(sale.total) || refunded > received) throw new NuvemshopError(400, "Movimento excede o total ou o valor recebido.");
        await client.query(`INSERT INTO movimentos_financeiros_venda (venda_id,usuario_id,requisicao_id,conteudo_hash,tipo,valor,forma_pagamento,ocorrido_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, auth.usuarioId, key, hash(input), input.tipo, input.valor, input.formaPagamento, input.ocorridoEm]);
        const updated = await client.query("UPDATE vendas_externas SET valor_recebido = $3, valor_estornado = $4 WHERE id = $1 AND loja_id = $2 AND valor_recebido=$5 AND valor_estornado=$6", [id, auth.lojaId, money(received), money(refunded), sale.valorRecebido, sale.valorEstornado]);
        if (updated.rowCount !== 1) throw new NuvemshopError(409, "Estado financeiro não confirmado. Consulte a mesma venda.");
        return load(client, auth, id);
      }));
    },
    async cancel(auth, id) {
      return repository.withSale(auth, id, () => transaction(auth, async client => {
        await client.query("SELECT id FROM vendas_externas WHERE id=$1 AND loja_id=$2 FOR UPDATE", [id, auth.lojaId]);
        await client.query("UPDATE vendas_externas SET situacao = 'cancelada', cancelada_em = COALESCE(cancelada_em, now()) WHERE id = $1 AND loja_id = $2 AND situacao='confirmada'", [id, auth.lojaId]);
        return load(client, auth, id);
      }));
    },
    async summary(auth, month) {
      await store(auth); const period = await repository.period(month);
      const result = await database.query(`WITH comercial AS (
        SELECT moeda, canal, count(*) FILTER (WHERE situacao = 'confirmada') AS vendas,
          COALESCE(sum(total) FILTER (WHERE situacao = 'confirmada'),0)::numeric(30,2)::text AS "valorVendido",
          count(*) FILTER (WHERE situacao = 'confirmada' AND valor_recebido - valor_estornado < total) AS "pagamentosPendentes"
        FROM vendas_externas WHERE loja_id = $1 AND vendida_em >= $2 AND vendida_em < $3 GROUP BY moeda,canal
      ), financeiro AS (
        SELECT v.moeda,v.canal, sum(CASE WHEN m.tipo = 'recebimento' THEN m.valor ELSE 0 END)::numeric(30,2)::text AS recebimentos,
          sum(CASE WHEN m.tipo = 'estorno' THEN m.valor ELSE 0 END)::numeric(30,2)::text AS estornos,
          sum(CASE WHEN m.tipo = 'recebimento' THEN m.valor ELSE -m.valor END)::numeric(30,2)::text AS "recebidoLiquido"
        FROM movimentos_financeiros_venda m JOIN vendas_externas v ON v.id = m.venda_id
        WHERE v.loja_id = $1 AND m.ocorrido_em >= $2 AND m.ocorrido_em < $3 GROUP BY v.moeda,v.canal
      ) SELECT COALESCE(c.moeda,f.moeda) AS moeda,COALESCE(c.canal,f.canal) AS canal,COALESCE(c.vendas,0) AS vendas,
        COALESCE(c."valorVendido",'0.00') AS "valorVendido", COALESCE(c."pagamentosPendentes",0) AS "pagamentosPendentes",
        COALESCE(f.recebimentos,'0.00') AS recebimentos,COALESCE(f.estornos,'0.00') AS estornos,COALESCE(f."recebidoLiquido",'0.00') AS "recebidoLiquido"
        FROM comercial c FULL JOIN financeiro f ON c.moeda=f.moeda AND c.canal=f.canal ORDER BY moeda,canal`, [auth.lojaId, period.inicio, period.fim]);
      const stock = await database.query(`SELECT count(*) FILTER (WHERE b.id IS NULL OR b.status_sincronizacao <> 'sincronizada') AS pendentes,
        count(*) FILTER (WHERE b.status_sincronizacao NOT IN ('registrada','sincronizada','rejeitada')) AS incertas
        FROM itens_venda_externa i JOIN vendas_externas v ON v.id=i.venda_id LEFT JOIN baixas_estoque b ON b.id=i.baixa_id
        WHERE v.loja_id=$1 AND v.situacao='confirmada' AND v.vendida_em >= $2 AND v.vendida_em < $3`, [auth.lojaId, period.inicio, period.fim]);
      return { ...period, totais: result.rows.map(row => ({ ...row, vendas: Number(row.vendas), pagamentosPendentes: Number(row.pagamentosPendentes) })),
        estoque: { pendentes: Number(stock.rows[0].pendentes), incertas: Number(stock.rows[0].incertas) } };
    },
  };
  return repository;
}
