import assert from "node:assert/strict";
import { it } from "node:test";
import { countLabel, paymentLabel, userMessage } from "../src/app/components/presentation";
import { splitPaymentMethod, validPaymentMethod, validateSaleForm } from "../src/app/sales/form";

it("mensagens preservam ações úteis e traduzem detalhes técnicos sem expor códigos", () => {
  assert.equal(userMessage("Saldo zero exige conferência."), "Saldo zero exige conferência.");
  assert.equal(userMessage(new Error("Permissão read_orders ausente (HTTP 403)")), "O acesso aos pedidos da loja online ainda não está liberado.");
  for (const message of ["API indisponível", "token inválido", "UUID 11111111-1111-4111-8111-111111111111", "payload inválido", "HTTP 409"]) {
    assert.equal(userMessage(message, "Confira a venda."), "Confira a venda.");
  }
  assert.equal(paymentLabel("partially_paid"), "Parcial"); assert.equal(paymentLabel("partially_unknown"), "A conferir");
  assert.equal(countLabel(1, "item", "itens"), "1 item"); assert.equal(countLabel(2, "item", "itens"), "2 itens");
});
it("Outro aceita complemento explícito sem inventar código de pagamento ou alterar o contrato", () => {
  assert.ok(validPaymentMethod("Outro")); assert.ok(validPaymentMethod("Outro: Vale-presente"));
  assert.equal(validPaymentMethod("Boleto"), false); assert.equal(validPaymentMethod("Outro: " + "x".repeat(80)), false);
  assert.equal(validPaymentMethod("Outro: Pix\nCartão"), false);
  assert.deepEqual(splitPaymentMethod("Outro: Vale-presente"), { method: "Outro", other: "Vale-presente" });
  assert.deepEqual(splitPaymentMethod("Boleto antigo"), { method: "Outro", other: "Boleto antigo" });
});
it("resumo separa subtotal, descontos totais e total final usando centavos exatos", () => {
  const result = validateSaleForm({ canal: "Presencial", formaPagamento: "Outro: Vale", moeda: "BRL", vendidaEm: "2026-11-01T12:00", descontoVenda: "0,40",
    situacao: "pago", valorRecebido: "2.400,00", recebidoEm: "2026-11-01T12:00", itens: [{ produtoId: "100", varianteId: "101", quantidade: "2", preco: "1.250,25", desconto: "100,10" }] });
  assert.ok(result.body); assert.equal(result.subtotal, "2500.50"); assert.equal(result.discounts, "100.50"); assert.equal(result.total, "2400.00");
  assert.equal(result.body.formaPagamento, "Outro: Vale"); assert.equal("total" in result.body, false);
});
