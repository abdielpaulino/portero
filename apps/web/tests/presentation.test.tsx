import assert from "node:assert/strict";
import { it } from "node:test";
import { countLabel, paymentLabel, userMessage } from "../src/app/components/presentation";

it("mensagens preservam ações úteis e traduzem detalhes técnicos sem expor códigos", () => {
  assert.equal(userMessage("Saldo zero exige conferência."), "Saldo zero exige conferência.");
  assert.equal(userMessage(new Error("Permissão read_orders ausente (HTTP 403)")), "O acesso aos pedidos da loja online ainda não está liberado.");
  for (const message of ["API indisponível", "token inválido", "UUID 11111111-1111-4111-8111-111111111111", "payload inválido", "HTTP 409"]) {
    assert.equal(userMessage(message, "Confira a venda."), "Confira a venda.");
  }
  assert.equal(paymentLabel("partially_paid"), "Parcial"); assert.equal(paymentLabel("partially_unknown"), "A conferir");
  assert.equal(countLabel(1, "item", "itens"), "1 item"); assert.equal(countLabel(2, "item", "itens"), "2 itens");
});
