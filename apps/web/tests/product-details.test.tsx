import assert from "node:assert/strict";
import { it } from "node:test";
import { carregarProduto } from "../src/app/productDetails/data";

const item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "9", sku: "LUVA-9", preco: 100, quantidade: 8, ruptura: false };

it("consulta os detalhes no proxy protegido, sem cache ou credenciais Nuvemshop no navegador", async () => {
  const controller = new AbortController();
  const product = await carregarProduto("100", controller.signal, async (url, init) => {
    assert.equal(url, "/api/inventory/products/100"); assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store"); assert.equal(init?.signal, controller.signal);
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({ produtoId: "100", nome: "Luva", items: [item] });
  });
  assert.equal(product.items[0].sku, "LUVA-9");
});

it("detalhes distinguem sessão expirada, falta de acesso, remoção e erro remoto", async () => {
  for (const [status, message] of [[401, /Sessão expirada/], [403, /acesso/], [404, /não encontrado/], [503, /carregar o produto/]] as const)
    await assert.rejects(carregarProduto("100", undefined, async () => new Response(null, { status })), message);
});

it("recusa IDs inválidos e respostas com produto ou variante de outro produto", async () => {
  await assert.rejects(carregarProduto("../outro", undefined, async () => { assert.fail("Não deve consultar"); }), /produto válido/);
  for (const body of [null, {}, { produtoId: "200", nome: "Outro", items: [item] },
    { produtoId: "100", nome: "Luva", items: [{ ...item, produtoId: "200" }] }])
    await assert.rejects(carregarProduto("100", undefined, async () => Response.json(body)), /inválida/);
});
