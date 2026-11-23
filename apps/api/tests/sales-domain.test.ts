import assert from "node:assert/strict";
import { it } from "node:test";
import { cents, money, paymentStatus, presentSale, validateFinancial, validateSale } from "../src/sales/domain.js";
import { key, salesFixture } from "./sales-fixture.js";

export const saleBody = { canal: "WhatsApp", formaPagamento: "Pix", moeda: "BRL", vendidaEm: "2026-11-01T00:30:00-03:00", descontoVenda: "0.00",
  pagamento: { situacao: "parcial", valorRecebido: "0.10", recebidoEm: "2026-11-02T12:00:00-03:00" },
  itens: [{ produtoId: "100", varianteId: "101", quantidade: 3, precoUnitario: "0.10", desconto: "0.00" }] };

it("calcula preços efetivos e descontos com centavos exatos, inclusive acima do inteiro seguro JS", () => {
  const result = validateSale(saleBody);
  assert.equal(result.total, "0.30"); assert.equal(result.valorRecebido, "0.10");
  assert.equal(result.vendidaEm, "2026-11-01T03:30:00.000Z");
  assert.equal(money(cents("9999999999999999.99")), "9999999999999999.99");
  const discounted = validateSale({ ...saleBody, descontoVenda: "0.05", itens: [{ ...saleBody.itens[0], desconto: "0.05" }] });
  assert.equal(discounted.total, "0.20");
});
it("recusa números binários, precisão excedente, totais negativos e variantes duplicadas", () => {
  for (const value of [0.1, NaN, Infinity, null, "0.001", "NaN", "nan", "Infinity", "-Infinity", "-1.00", "1,00", "1e2", "10000000000000000.00"])
    assert.throws(() => cents(value), { status: 400 });
  assert.throws(() => validateSale({ ...saleBody, descontoVenda: "0.40" }));
  assert.throws(() => validateSale({ ...saleBody, itens: [saleBody.itens[0], saleBody.itens[0]] }));
  assert.throws(() => validateSale({ ...saleBody, moeda: "JPY" }));
  assert.throws(() => validateSale({ ...saleBody, lojaId: 20 }));
});
it("serializa valores exatos do PostgreSQL com duas casas, inclusive defaults sem escala", async () => {
  const f = salesFixture(), input = validateSale(saleBody);
  const sale = await f.repository.create({ usuarioId: 1, lojaId: 10 }, key, "hash", input, input.itens.map(item => ({ ...item, nomeProduto: "Luva", nomeVariante: "Única", sku: null })));
  sale.valorEstornado = "0"; sale.descontoVenda = "0"; sale.itens[0].desconto = "0";
  const data = presentSale(sale);
  assert.equal(data.valorEstornado, "0.00"); assert.equal(data.descontoVenda, "0.00"); assert.equal(data.itens[0].desconto, "0.00");
});
it("pagamento informado deve corresponder ao total e ter data de recebimento quando positivo", () => {
  assert.throws(() => validateSale({ ...saleBody, pagamento: { situacao: "pago", valorRecebido: "0.10", recebidoEm: saleBody.pagamento.recebidoEm } }));
  assert.throws(() => validateSale({ ...saleBody, pagamento: { situacao: "pendente", valorRecebido: "0.10" } }));
  assert.throws(() => validateSale({ ...saleBody, pagamento: { situacao: "parcial", valorRecebido: "0.10" } }));
  assert.throws(() => validateSale({ ...saleBody, vendidaEm: "2026-02-30T12:00:00Z" }));
});
it("movimentos financeiros são datados, positivos e não contêm instruções de estoque", () => {
  const event = validateFinancial({ tipo: "estorno", valor: "0.05", formaPagamento: "Pix", ocorridoEm: "2026-12-01T00:00:00-03:00" });
  assert.equal(event.ocorridoEm, "2026-12-01T03:00:00.000Z");
  assert.throws(() => validateFinancial({ ...event, reporEstoque: true }));
  assert.throws(() => validateFinancial({ ...event, valor: "0.00" }));
});
it("situação financeira é independente da sincronização e preserva recebimentos e estornos", () => {
  assert.equal(paymentStatus({ total: "10.00", valorRecebido: "0.00", valorEstornado: "0.00" }), "pendente");
  assert.equal(paymentStatus({ total: "10.00", valorRecebido: "5.00", valorEstornado: "0.00" }), "parcial");
  assert.equal(paymentStatus({ total: "10.00", valorRecebido: "10.00", valorEstornado: "10.00" }), "estornado");
  assert.equal(paymentStatus({ total: "10.00", valorRecebido: "15.00", valorEstornado: "5.00" }), "pago");
});
