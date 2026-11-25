import assert from "node:assert/strict";
import { it } from "node:test";
import { catalogMoney, formatMoneyInput, parseMoneyInput } from "../src/app/sales/money";
import { PAYMENT_METHODS, validateFinancialForm, validateSaleForm, type SaleForm } from "../src/app/sales/form";

const form: SaleForm = { canal: "WhatsApp", formaPagamento: "Pix", moeda: "BRL", vendidaEm: "2026-11-01T12:00", descontoVenda: "0,00",
  situacao: "pendente", valorRecebido: "0,00", recebidoEm: "", itens: [{ produtoId: "100", varianteId: "101", quantidade: "1", preco: "1.250,00", desconto: "0,00" }] };

it("normaliza reais, vírgula decimal e milhares sem alterar centavos", () => {
  for (const [input, expected] of [["R$ 1.250,00", "1250.00"], ["1.250,00", "1250.00"], ["1250,0", "1250.00"], ["1.250", "1250.00"],
    ["1250.00", "1250.00"], ["1,25", "1.25"], ["0,01", "0.01"], ["0.1", "0.10"], ["0,00", "0.00"], ["R$\u00a01.250,99", "1250.99"], ["0001,20", "1.20"]]) {
    assert.equal(parseMoneyInput(input, "BRL"), expected, input);
    assert.equal(parseMoneyInput(formatMoneyInput(expected), "BRL"), expected);
  }
});
it("rejeita valores inválidos e agrupamentos ambíguos em vez de adivinhar ou arredondar", () => {
  for (const value of ["", " ", "NaN", "Infinity", "-1,00", "1e3", "1,234", "1.2345", "1,250.00", "12.34,56", "1.23.456,78", "R$ 1 250,00", "10abc", ",50", "10000000000000000.00"]) {
    assert.equal(parseMoneyInput(value, "BRL"), null, value);
  }
});
it("preserva centavos acima do inteiro seguro e mantém BRL, USD e EUR", () => {
  for (const currency of ["BRL", "USD", "EUR"]) {
    assert.equal(parseMoneyInput("9.999.999.999.999.999,99", currency), "9999999999999999.99");
    assert.equal(parseMoneyInput("1234.56", currency), "1234.56");
    assert.equal(parseMoneyInput("1.234,56", currency), "1234.56");
    const result = validateSaleForm({ ...form, moeda: currency, situacao: "pago", valorRecebido: "9.999.999.999.999.999,99", recebidoEm: form.vendidaEm,
      itens: [{ ...form.itens[0], preco: "9.999.999.999.999.999,99" }] });
    assert.equal(result.body?.pagamento.valorRecebido, "9999999999999999.99"); assert.equal(result.total, "9999999999999999.99");
  }
  assert.equal(catalogMoney(1250.25), "1.250,25");
  for (const value of [null, NaN, Infinity, 1.005, 9999999999999999]) assert.equal(catalogMoney(value), "");
});
it("calcula itens, descontos e total com precisão e envia somente os campos do contrato", () => {
  const result = validateSaleForm({ ...form, descontoVenda: "0,03", itens: [
    { ...form.itens[0], quantidade: "3", preco: "0,10", desconto: "0,02" }, { ...form.itens[0], varianteId: "102", preco: "0,20", desconto: "0,00" },
  ] });
  assert.equal(result.subtotal, "0.50"); assert.deepEqual(result.lineTotals, ["0.28", "0.20"]); assert.equal(result.total, "0.45");
  assert.equal(result.body?.descontoVenda, "0.03"); assert.equal(result.body?.itens[0].precoUnitario, "0.10");
  assert.ok(result.body); assert.equal("total" in result.body, false); assert.equal("total" in result.body.itens[0], false);
});
it("valida Pendente, Parcial e Pago contra o total e exige a data somente quando há recebimento", () => {
  for (const [situacao, value, valid] of [["pendente", "0,00", true], ["pendente", "0,01", false], ["parcial", "0,00", false], ["parcial", "1,00", true],
    ["parcial", "1.250,00", false], ["parcial", "1.250,01", false], ["pago", "0,00", false], ["pago", "1.250,00", true], ["pago", "1.250,01", false]] as const) {
    const result = validateSaleForm({ ...form, situacao, valorRecebido: value, recebidoEm: form.vendidaEm });
    assert.equal(!!result.body, valid, `${situacao}: ${value}`); if (!valid) assert.ok(result.errors.situacao);
  }
  assert.ok(validateSaleForm(form).body); assert.equal("recebidoEm" in validateSaleForm(form).body!.pagamento, false);
  assert.ok(validateSaleForm({ ...form, situacao: "parcial", valorRecebido: "1,00" }).errors.recebidoEm);
});
it("total zero aceita recebido zero como Pendente ou Pago e recusa Parcial, conforme a API", () => {
  const zero = { ...form, descontoVenda: "1.250,00" };
  for (const situacao of ["pendente", "pago"]) {
    const result = validateSaleForm({ ...zero, situacao }); assert.equal(result.total, "0.00"); assert.ok(result.body);
    assert.equal("recebidoEm" in result.body.pagamento, false);
  }
  assert.match(validateSaleForm({ ...zero, situacao: "parcial" }).errors.situacao, /Total zero/);
  assert.ok(validateSaleForm({ ...zero, situacao: "pago", valorRecebido: "0,01", recebidoEm: form.vendidaEm }).errors.situacao);
});
it("rejeita descontos excessivos, quantidade inválida e estouro dos totais", () => {
  assert.ok(validateSaleForm({ ...form, descontoVenda: "1.250,01" }).errors.descontoVenda);
  assert.ok(validateSaleForm({ ...form, itens: [{ ...form.itens[0], desconto: "1.250,01" }] }).errors["itens.0.desconto"]);
  for (const quantidade of ["NaN", "0", "1,5", "2147483648"]) assert.ok(validateSaleForm({ ...form, itens: [{ ...form.itens[0], quantidade }] }).errors["itens.0.quantidade"]);
  assert.ok(validateSaleForm({ ...form, itens: [{ ...form.itens[0], quantidade: "2", preco: "9999999999999999.99" }] }).errors["itens.0.preco"]);
  assert.ok(validateSaleForm({ ...form, itens: [{ ...form.itens[0], preco: "9999999999999999.99" }, { ...form.itens[0], varianteId: "102" }] }).errors.itens);
});
it("mantém forma de pagamento separada da situação e exige uma das seis opções", () => {
  assert.deepEqual(PAYMENT_METHODS, ["Pix", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Transferência bancária", "Outro"]);
  for (const formaPagamento of PAYMENT_METHODS) assert.equal(validateSaleForm({ ...form, formaPagamento }).body?.formaPagamento, formaPagamento);
  assert.ok(validateSaleForm({ ...form, formaPagamento: "pago" }).errors.formaPagamento);
  assert.ok(validateSaleForm({ ...form, vendidaEm: "2026-02-30T12:00" }).errors.vendidaEm);
});
it("movimentos financeiros normalizam o valor exato e recusam zero ou valor inválido antes do envio", () => {
  const input = { tipo: "recebimento", valor: "1.250,99", formaPagamento: "Pix", ocorridoEm: "2026-11-01T12:00" };
  assert.equal(validateFinancialForm(input, "BRL").body?.valor, "1250.99");
  for (const valor of ["0,00", "NaN", "1,234", "-1,00"]) assert.ok(validateFinancialForm({ ...input, valor }, "BRL").errors.valor);
});
