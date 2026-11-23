import { NuvemshopError } from "../src/nuvemshop/oauth.js";
import { cents, hash, money, type FinancialInput, type PreparedItem, type Sale, type SaleInput } from "../src/sales/domain.js";
import type { SalesRepository } from "../src/sales/repository.js";
import type { StockRecord, StockRepository } from "../src/stock/service.js";

export const inputBody = { canal: "WhatsApp", formaPagamento: "Pix", moeda: "BRL", vendidaEm: "2026-11-01T12:00:00-03:00", descontoVenda: "0.00",
  pagamento: { situacao: "parcial", valorRecebido: "5.00", recebidoEm: "2026-11-01T12:00:00-03:00" },
  itens: [{ produtoId: "100", varianteId: "101", quantidade: 1, precoUnitario: "10.00", desconto: "0.00" },
    { produtoId: "100", varianteId: "102", quantidade: 2, precoUnitario: "20.00", desconto: "0.00" }] };
export const key = "11111111-1111-4111-8111-111111111111";
const copy = <T>(value: T): T => structuredClone(value);

// Somente simulação: produção usa transações, constraints e locks do PostgreSQL.
export function salesFixture() {
  const sales: Sale[] = [], operations: StockRecord[] = [], held = new Set<number>(), financialKeys = new Map<string, string>();
  const state = { access: true, failCreateResponse: false, failPrepareResponse: false, failFinalize: false };
  const assertAccess = (auth: { usuarioId: number; lojaId: number }) => { if (!state.access || auth.lojaId !== 10 || ![1, 2].includes(auth.usuarioId)) throw new NuvemshopError(403, "Acesso revogado"); };
  const period = { periodo: "2026-11", fuso: "America/Sao_Paulo", inicio: "2026-11-01T03:00:00.000Z", fim: "2026-12-01T03:00:00.000Z" };
  const get = (id: number) => { const sale = sales.find(sale => sale.id === id); if (!sale) throw new NuvemshopError(404, "Venda não encontrada"); return sale; };
  function view(id: number) { const sale = copy(get(id)); for (const item of sale.itens) item.estoque = operations.find(op => op.id === item.baixaId)?.statusSincronizacao ?? "nao_solicitada"; return sale; }
  const repository: SalesRepository = {
    async store(auth) { assertAccess(auth); return { id: 10, nuvemshopStoreId: "123", accessToken: "token-ficticio" }; },
    async period(month) { if (month !== "2026-11") throw new NuvemshopError(400, "Período inválido"); return period; },
    async findRequest(auth, requestKey) { assertAccess(auth); const sale = sales.find(sale => sale.usuarioId === auth.usuarioId && sale.requisicaoId === requestKey); return sale ? view(sale.id) : null; },
    async create(auth, requestKey, fingerprint, input: SaleInput, items: PreparedItem[]) {
      assertAccess(auth);
      const previous = sales.find(sale => sale.requisicaoId === requestKey);
      if (previous) { if (previous.usuarioId !== auth.usuarioId) throw new NuvemshopError(403, "Outro autor"); if (previous.conteudoHash !== fingerprint) throw new NuvemshopError(409, "Chave com outros dados"); return view(previous.id); }
      const id = sales.length + 1;
      const sale: Sale = { id, usuarioId: auth.usuarioId, requisicaoId: requestKey, conteudoHash: fingerprint, canal: input.canal, formaPagamento: input.formaPagamento,
        moeda: input.moeda, vendidaEm: input.vendidaEm, situacao: "confirmada", subtotal: input.subtotal, descontosItens: input.descontosItens,
        descontoVenda: input.descontoVenda, total: input.total, valorRecebido: input.valorRecebido, valorEstornado: "0.00", criadaEm: period.inicio,
        itens: items.map((item, i) => ({ ...item, id: id * 100 + i, baixaId: null, estoque: "nao_solicitada" })), movimentos: [] };
      if (cents(input.valorRecebido) > 0n) {
        const initial: FinancialInput = { tipo: "recebimento", valor: input.valorRecebido, formaPagamento: input.formaPagamento, ocorridoEm: input.recebidoEm! };
        sale.movimentos.push({ ...initial, id: 1, usuarioId: auth.usuarioId, registradoEm: period.inicio });
        financialKeys.set(`${id}:${requestKey}`, hash(initial));
      }
      sales.push(sale);
      if (state.failCreateResponse) throw new Error("Resposta de commit perdida");
      return view(id);
    },
    async get(auth, id) { assertAccess(auth); return view(id); },
    async list(auth) { assertAccess(auth); return { items: sales.map(sale => view(sale.id)), hasMore: false }; },
    async summary(auth) { assertAccess(auth); return { ...period, totais: [], estoque: { pendentes: 0, incertas: 0 } }; },
    async withSale(auth, id, work) {
      assertAccess(auth); if (get(id).usuarioId !== auth.usuarioId) throw new NuvemshopError(403, "Outro autor");
      if (held.has(id)) throw new NuvemshopError(409, "Venda ocupada");
      held.add(id); try { return await work(view(id)); } finally { held.delete(id); }
    },
    async prepareItem(auth, id, itemId) {
      assertAccess(auth); const item = get(id).itens.find(item => item.id === itemId)!;
      if (item.baixaId !== null) return item.baixaId;
      if (operations.some(op => op.variantId === item.varianteId && !["sincronizada", "rejeitada"].includes(op.statusSincronizacao))) throw new NuvemshopError(409, "Outra pendência");
      const op = { id: operations.length + 1, usuarioId: auth.usuarioId, produtoId: item.produtoId, variantId: item.varianteId, quantidadeBaixada: item.quantidade, statusSincronizacao: "registrada" };
      operations.push(op); item.baixaId = op.id;
      if (state.failPrepareResponse) throw new NuvemshopError(503, "Resposta do vínculo perdida");
      return op.id;
    },
    async financial(auth, id, requestKey, input: FinancialInput) {
      return repository.withSale(auth, id, async () => {
        const sale = get(id), eventKey = `${id}:${requestKey}`;
        if (financialKeys.has(eventKey)) { if (financialKeys.get(eventKey) !== hash(input)) throw new NuvemshopError(409, "Chave com outros dados"); return view(id); }
        const received = cents(sale.valorRecebido) + (input.tipo === "recebimento" ? cents(input.valor) : 0n);
        const refunded = cents(sale.valorEstornado) + (input.tipo === "estorno" ? cents(input.valor) : 0n);
        if (received - refunded > cents(sale.total) || refunded > received || (sale.situacao === "cancelada" && input.tipo === "recebimento")) throw new NuvemshopError(400, "Valor inválido");
        sale.valorRecebido = money(received); sale.valorEstornado = money(refunded); financialKeys.set(eventKey, hash(input));
        sale.movimentos.push({ ...input, id: sale.movimentos.length + 1, registradoEm: period.inicio, usuarioId: auth.usuarioId }); return view(id);
      });
    },
    async cancel(auth, id) { return repository.withSale(auth, id, async () => { get(id).situacao = "cancelada"; return view(id); }); },
  };
  const stock: StockRepository = { async withLock(auth, target, work, expectedSale) {
    assertAccess(auth); const operation = operations.find(op => op.id === target && op.usuarioId === auth.usuarioId);
    if (!operation) throw new NuvemshopError(404, "Baixa ausente");
    const sale = sales.find(sale => sale.itens.some(item => item.baixaId === operation.id))!;
    if (expectedSale !== undefined && sale.id !== expectedSale) throw new NuvemshopError(409, "Venda divergente");
    return work({ operation: copy(operation), externalSale: { id: sale.id, situacao: sale.situacao }, store: await repository.store(auth),
      async hasUnresolved(except) { return operations.some(op => op.variantId === operation.variantId && op.id !== except && !["sincronizada", "rejeitada"].includes(op.statusSincronizacao)); },
      async create() { throw new Error("Não deve recriar"); },
      async prepare() { operation.statusSincronizacao = "em_processamento"; },
      async status(_id, status) { if (state.failFinalize) throw new Error("Falha local"); operation.statusSincronizacao = status; },
    });
  } };
  return { repository, stock, sales, operations, state };
}
