import type { SaleDraft } from "./data";
import { MAX_MONEY, moneyAmount, moneyCents, parseMoneyInput } from "./money";

export const PAYMENT_METHODS = ["Pix", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Transferência bancária", "Outro"];
export function validPaymentMethod(value: string) {
  return PAYMENT_METHODS.includes(value) || (/^Outro: \S/.test(value) && value.length <= 80 && !/[\x00-\x1f]/.test(value));
}
export function splitPaymentMethod(value: string) {
  return PAYMENT_METHODS.includes(value) ? { method: value, other: "" } : { method: "Outro", other: value.replace(/^Outro: /, "") };
}
export type FieldErrors = Record<string, string>;
export type SaleForm = {
  canal: string; formaPagamento: string; moeda: string; vendidaEm: string; descontoVenda: string;
  situacao: string; valorRecebido: string; recebidoEm: string;
  itens: { produtoId: string; varianteId: string; quantidade: string; preco: string; desconto: string }[];
};
const zero = BigInt(0);
export function localDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateInput(date.toISOString()) !== value) return null;
  return date.toISOString();
}
export function localDateInput(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function amount(value: string, currency: string, field: string, errors: FieldErrors) {
  const parsed = parseMoneyInput(value, currency);
  if (parsed === null) errors[field] = value.trim() ? "Informe um valor válido, como 1.250,00." : "Informe um valor.";
  return parsed;
}
export function validateSaleForm(form: SaleForm) {
  const errors: FieldErrors = {}, lineTotals: (string | null)[] = [], items: SaleDraft["itens"] = [];
  let subtotal = zero, discounts = zero, complete = form.itens.length > 0;
  if (!form.canal.trim() || form.canal.trim().length > 80 || /[\x00-\x1f]/.test(form.canal)) errors.canal = "Informe o canal da venda.";
  if (!validPaymentMethod(form.formaPagamento)) errors.formaPagamento = "Selecione a forma de pagamento (até 80 caracteres).";
  if (!["BRL", "USD", "EUR"].includes(form.moeda)) errors.moeda = "Selecione uma moeda disponível.";
  if (form.itens.length < 1 || form.itens.length > 20) errors.itens = "Selecione de um a vinte itens.";
  const variants = new Set<string>();
  form.itens.forEach((line, index) => {
    const key = `itens.${index}`, quantity = Number(line.quantidade);
    if (!/^\d+$/.test(line.quantidade.trim()) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) errors[`${key}.quantidade`] = "Informe uma quantidade inteira positiva.";
    if (!/^[1-9]\d{0,19}$/.test(line.produtoId) || !/^[1-9]\d{0,19}$/.test(line.varianteId) || !Number.isSafeInteger(Number(line.varianteId)) || variants.has(line.varianteId)) errors.itens = "Confira as variantes selecionadas.";
    variants.add(line.varianteId);
    const price = amount(line.preco, form.moeda, `${key}.preco`, errors), discount = amount(line.desconto, form.moeda, `${key}.desconto`, errors);
    if (price === null || discount === null || errors[`${key}.quantidade`]) { complete = false; lineTotals.push(null); return; }
    const gross = moneyCents(price) * BigInt(quantity), reduction = moneyCents(discount);
    if (gross > MAX_MONEY) errors[`${key}.preco`] = "O total do item excede o limite permitido.";
    if (reduction > gross) errors[`${key}.desconto`] = "O desconto não pode superar o valor do item.";
    if (gross > MAX_MONEY || reduction > gross) { complete = false; lineTotals.push(null); return; }
    subtotal += gross; discounts += reduction;
    lineTotals.push(moneyAmount(gross - reduction));
    items.push({ produtoId: line.produtoId, varianteId: line.varianteId, quantidade: quantity, precoUnitario: price, desconto: discount });
  });
  if (subtotal > MAX_MONEY || discounts > MAX_MONEY) { errors.itens = "O total dos itens excede o limite permitido."; complete = false; }
  const discount = amount(form.descontoVenda, form.moeda, "descontoVenda", errors);
  let total: string | null = null;
  if (complete && discount !== null) {
    const net = subtotal - discounts - moneyCents(discount);
    if (net < zero) errors.descontoVenda = "O desconto não pode superar o valor da venda.";
    else total = moneyAmount(net);
  }
  const received = amount(form.valorRecebido, form.moeda, "valorRecebido", errors);
  if (!["pendente", "parcial", "pago"].includes(form.situacao)) errors.situacao = "Selecione a situação do pagamento.";
  else if (received !== null && total !== null) {
    const paid = moneyCents(received), value = moneyCents(total);
    if (form.situacao === "pendente" && paid !== zero) errors.situacao = "Pendente exige valor recebido igual a zero.";
    if (form.situacao === "parcial" && !(paid > zero && paid < value)) errors.situacao = value === zero ? "Total zero não permite pagamento parcial." : "Parcial exige recebido maior que zero e menor que o total.";
    if (form.situacao === "pago" && paid !== value) errors.situacao = "Pago exige valor recebido igual ao total.";
  }
  const date = localDate(form.vendidaEm);
  if (!date) errors.vendidaEm = "Informe a data da venda.";
  const receivedDate = received !== null && moneyCents(received) > zero ? localDate(form.recebidoEm) : null;
  if (received !== null && moneyCents(received) > zero && !receivedDate) errors.recebidoEm = "Informe a data do recebimento.";
  const body: SaleDraft | null = Object.keys(errors).length ? null : { canal: form.canal.trim(), formaPagamento: form.formaPagamento, moeda: form.moeda,
    vendidaEm: date!, descontoVenda: discount!, pagamento: { situacao: form.situacao, valorRecebido: received!, ...(receivedDate ? { recebidoEm: receivedDate } : {}) }, itens: items };
  return { errors, body, total, lineTotals, subtotal: complete ? moneyAmount(subtotal) : null,
    discounts: complete && discount !== null ? moneyAmount(discounts + moneyCents(discount)) : null };
}

export function validateFinancialForm(form: { tipo: string; valor: string; formaPagamento: string; ocorridoEm: string }, currency: string) {
  const errors: FieldErrors = {}, value = amount(form.valor, currency, "valor", errors), date = localDate(form.ocorridoEm);
  if (value !== null && moneyCents(value) === zero) errors.valor = "Informe um valor maior que zero.";
  if (!validPaymentMethod(form.formaPagamento)) errors.formaPagamento = "Selecione a forma de pagamento (até 80 caracteres).";
  if (!date) errors.ocorridoEm = "Informe a data do movimento.";
  if (!["recebimento", "estorno"].includes(form.tipo)) errors.tipo = "Selecione o movimento.";
  return { errors, body: Object.keys(errors).length ? null : { tipo: form.tipo, valor: value!, formaPagamento: form.formaPagamento, ocorridoEm: date! } };
}
