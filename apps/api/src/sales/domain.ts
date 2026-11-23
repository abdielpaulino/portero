import { createHash } from "node:crypto";
import { NuvemshopError } from "../nuvemshop/oauth.js";

const max = 999_999_999_999_999_999n;
export function cents(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) throw new NuvemshopError(400, "Valores monetários devem ser textos decimais com até duas casas.");
  const [integer, decimal = ""] = value.split(".");
  return BigInt(integer) * 100n + BigInt(decimal.padEnd(2, "0"));
}
export function money(value: bigint): string {
  if (value < 0n || value > max) throw new NuvemshopError(400, "Valor monetário fora do limite permitido.");
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new NuvemshopError(400, "Campos inválidos na solicitação.");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\x00-\x1f]/.test(value)) throw new NuvemshopError(400, "Informe canal e forma de pagamento válidos.");
  return value.trim();
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new NuvemshopError(400, "Informe uma chave de requisição UUID v4.");
  return value.toLowerCase();
}
export function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new NuvemshopError(400, "Informe data e hora válidas com fuso horário.");
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new NuvemshopError(400, "Data inexistente no calendário.");
  return new Date(value).toISOString();
}
export function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export type SaleItemInput = { produtoId: string; varianteId: string; quantidade: number; precoUnitario: string; desconto: string; total: string };
export type SaleInput = {
  canal: string; formaPagamento: string; moeda: string; vendidaEm: string; subtotal: string; descontosItens: string;
  descontoVenda: string; total: string; valorRecebido: string; recebidoEm: string | null; itens: SaleItemInput[];
};
export type PreparedItem = SaleItemInput & { nomeProduto: string; nomeVariante: string; sku: string | null };
export type SaleItem = PreparedItem & { id: number; baixaId: number | null; estoque: string };
export type FinancialInput = { tipo: "recebimento" | "estorno"; valor: string; formaPagamento: string; ocorridoEm: string };
export type FinancialEvent = FinancialInput & { id: number; registradoEm: string; usuarioId: number };
export type Sale = {
  id: number; usuarioId: number; requisicaoId: string; conteudoHash: string; canal: string; formaPagamento: string; moeda: string;
  vendidaEm: string; situacao: string; subtotal: string; descontosItens: string; descontoVenda: string; total: string;
  valorRecebido: string; valorEstornado: string; criadaEm: string; itens: SaleItem[]; movimentos: FinancialEvent[];
};
export function validateSale(value: unknown): SaleInput {
  const body = object(value, ["canal", "formaPagamento", "moeda", "vendidaEm", "descontoVenda", "pagamento", "itens"]);
  const canal = text(body.canal), formaPagamento = text(body.formaPagamento);
  // Esta versão opera moedas de duas casas decimais; nunca arredonda uma moeda diferente silenciosamente.
  if (typeof body.moeda !== "string" || !["BRL", "USD", "EUR"].includes(body.moeda)) throw new NuvemshopError(400, "Moedas disponíveis nesta versão: BRL, USD e EUR.");
  if (!Array.isArray(body.itens) || !body.itens.length || body.itens.length > 20) throw new NuvemshopError(400, "Informe de um a vinte itens.");
  const variants = new Set<string>();
  let subtotal = 0n, discounts = 0n;
  const itens = body.itens.map(value => {
    const item = object(value, ["produtoId", "varianteId", "quantidade", "precoUnitario", "desconto"]);
    if (typeof item.produtoId !== "string" || !/^[1-9]\d{0,19}$/.test(item.produtoId) || typeof item.varianteId !== "string"
      || !/^[1-9]\d{0,19}$/.test(item.varianteId) || !Number.isSafeInteger(Number(item.varianteId)) || variants.has(item.varianteId)
      || typeof item.quantidade !== "number" || !Number.isInteger(item.quantidade) || item.quantidade <= 0 || item.quantidade > 2_147_483_647)
      throw new NuvemshopError(400, "Informe variantes distintas e quantidades inteiras positivas.");
    variants.add(item.varianteId);
    const unit = cents(item.precoUnitario), discount = cents(item.desconto), gross = unit * BigInt(item.quantidade);
    subtotal += gross; discounts += discount;
    return { produtoId: item.produtoId, varianteId: item.varianteId, quantidade: item.quantidade,
      precoUnitario: money(unit), desconto: money(discount), total: money(gross - discount) };
  });
  const descontoVenda = money(cents(body.descontoVenda)), total = money(subtotal - discounts - cents(descontoVenda));
  const payment = object(body.pagamento, ["situacao", "valorRecebido", "recebidoEm"]);
  const received = cents(payment.valorRecebido), amount = cents(total);
  if (!((payment.situacao === "pendente" && received === 0n) || (payment.situacao === "parcial" && received > 0n && received < amount)
    || (payment.situacao === "pago" && received === amount))) throw new NuvemshopError(400, "Situação do pagamento incompatível com o valor recebido e o total.");
  return { canal, formaPagamento, moeda: body.moeda, vendidaEm: date(body.vendidaEm), subtotal: money(subtotal), descontosItens: money(discounts),
    descontoVenda, total, valorRecebido: money(received), recebidoEm: received > 0n ? date(payment.recebidoEm) : null, itens };
}
export function validateFinancial(value: unknown): FinancialInput {
  const body = object(value, ["tipo", "valor", "formaPagamento", "ocorridoEm"]);
  if (!["recebimento", "estorno"].includes(String(body.tipo)) || cents(body.valor) === 0n) throw new NuvemshopError(400, "Informe recebimento ou estorno com valor positivo.");
  return { tipo: body.tipo as FinancialInput["tipo"], valor: money(cents(body.valor)), formaPagamento: text(body.formaPagamento), ocorridoEm: date(body.ocorridoEm) };
}
export function paymentStatus(sale: Pick<Sale, "total" | "valorRecebido" | "valorEstornado">) {
  const received = cents(sale.valorRecebido), refunded = cents(sale.valorEstornado);
  if (received - refunded === cents(sale.total)) return "pago";
  if (refunded > 0n) return refunded === received ? "estornado" : "parcialmente_estornado";
  return received === cents(sale.total) ? "pago" : received > 0n ? "parcial" : "pendente";
}
export function presentSale(sale: Sale) {
  const { conteudoHash: _hash, ...data } = sale;
  const states = sale.itens.map(item => item.estoque);
  return { ...data, subtotal: money(cents(sale.subtotal)), descontosItens: money(cents(sale.descontosItens)), descontoVenda: money(cents(sale.descontoVenda)),
    total: money(cents(sale.total)), valorRecebido: money(cents(sale.valorRecebido)), valorEstornado: money(cents(sale.valorEstornado)),
    itens: sale.itens.map(item => ({ ...item, precoUnitario: money(cents(item.precoUnitario)), desconto: money(cents(item.desconto)), total: money(cents(item.total)) })),
    movimentos: sale.movimentos.map(event => ({ ...event, valor: money(cents(event.valor)) })),
    origem: "portero" as const, situacaoPagamento: paymentStatus(sale),
    estoque: states.length > 0 && states.every(state => state === "sincronizada") ? "sincronizada" : states.some(state => ["sincronizada", "conferida_parcial"].includes(state)) ? "parcial" : "pendente",
    exigeConferencia: states.length === 0 || states.some(state => !["nao_solicitada", "registrada", "sincronizada", "rejeitada", "conferida_parcial"].includes(state)) };
}
