import assert from "node:assert/strict";
import { it } from "node:test";
import { agruparProdutos, carregarCatalogo, carregarInventario, filtrarItens, precoLabel, quantidadeLabel, type Item } from "../src/app/inventory/data";
import nextConfig from "../next.config";

const item: Item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva Portero",
  variante: "9 / Azul", sku: "LUVA-9", preco: 129.9, quantidade: 3, ruptura: false };

it("agrupa variantes pelo ID do produto, preservando produtos de mesmo nome e os saldos individuais", () => {
  const variant = { ...item, id: "100:102", varianteId: "102", variante: "10", quantidade: 7 };
  const sameName = { ...item, id: "200:201", produtoId: "200", varianteId: "201" };
  assert.deepEqual(agruparProdutos([item, sameName, variant]), [
    { produtoId: "100", variantes: [item, variant] }, { produtoId: "200", variantes: [sameName] },
  ]);
  assert.deepEqual(agruparProdutos([]), []);
});

it("busca de variante por nome ou SKU mantém o produto e somente as variantes correspondentes", () => {
  const variant = { ...item, id: "100:102", varianteId: "102", variante: "10 / Vermelha", sku: "LUVA-10" };
  for (const query of ["vermelha", "luva-10"]) {
    assert.deepEqual(agruparProdutos(filtrarItens([item, variant], query, "todos")), [{ produtoId: "100", variantes: [variant] }]);
  }
});

it("carrega uma página pelo proxy com cookie de sessão, sem credenciais da Nuvemshop", async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/inventory?page=2");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, controller.signal);
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({ items: [item], page: 2, nextPage: 3 });
  };
  assert.deepEqual(await carregarInventario(2, controller.signal, fetcher), { items: [item], page: 2, nextPage: 3 });
});

it("aceita inventário vazio e fim da paginação", async () => {
  assert.deepEqual(await carregarInventario(1, undefined, async () => Response.json({ items: [], page: 1, nextPage: null })),
    { items: [], page: 1, nextPage: null });
});

it("distingue sessão expirada, falta de permissão e falha da Nuvemshop", async () => {
  for (const [status, message] of [[401, /Sessão expirada/], [403, /acesso/], [503, /Tente novamente/]] as const) {
    await assert.rejects(carregarInventario(1, undefined, async () => new Response("corpo-remoto-nao-exibir", { status })), message);
  }
});

it("recusa respostas incompletas e páginas inconsistentes", async () => {
  for (const payload of [null, {}, { items: [{}], page: 1, nextPage: null },
    { items: [item], page: 2, nextPage: null }, { items: [item], page: 1, nextPage: 1 }]) {
    await assert.rejects(carregarInventario(1, undefined, async () => Response.json(payload)), /Resposta inválida/);
  }
});

it("busca por produto, variante e SKU, inclusive sem SKU", () => {
  const other = { ...item, id: "100:102", variante: "10 / Vermelha", sku: null };
  assert.deepEqual(filtrarItens([item, other], " azul ", "todos"), [item]);
  assert.deepEqual(filtrarItens([item, other], "LUVA-9", "todos"), [item]);
  assert.equal(filtrarItens([item, other], "portero", "todos").length, 2);
});

it("distingue ruptura, quantidade disponível e estoque sem controle nos filtros e rótulos", () => {
  const zero = { ...item, id: "100:102", quantidade: 0, ruptura: true };
  const unlimited = { ...item, id: "100:103", quantidade: null, ruptura: false, preco: null };
  assert.deepEqual(filtrarItens([item, zero, unlimited], "", "ruptura"), [zero]);
  assert.deepEqual(filtrarItens([item, zero, unlimited], "", "estoque"), [item, unlimited]);
  assert.equal(quantidadeLabel(zero), "0 UN");
  assert.equal(quantidadeLabel(unlimited), "Sem controle");
  assert.equal(precoLabel(unlimited), "Sob consulta");
  assert.match(precoLabel(item), /129,90/);
});

it("encaminha a listagem e a rota explícita de baixas sem expor um proxy genérico", async () => {
  const rewrites = await nextConfig.rewrites!();
  assert.ok(Array.isArray(rewrites));
  const inventory = rewrites.find((entry) => entry.source === "/api/inventory");
  assert.ok(inventory);
  assert.ok(inventory.destination.endsWith("/inventory"));
  assert.deepEqual(rewrites.filter((entry) => entry.source.startsWith("/api/inventory/")).map((entry) => entry.source),
    ["/api/inventory/stock-decreases", "/api/inventory/stock-decreases/:id/:action*", "/api/inventory/products/:id"]);
});

it("busca e filtros abrangem itens de páginas posteriores do catálogo", async () => {
  const later = { ...item, id: "200:201", produtoId: "200", varianteId: "201", nome: "Outra luva", sku: "SEGUNDA-PAGINA", quantidade: -1, ruptura: true };
  const calls: string[] = [];
  const items = await carregarCatalogo(undefined, async url => {
    calls.push(String(url));
    return Response.json(String(url).endsWith("=1") ? { page: 1, nextPage: 2, items: [item] }
      : { page: 2, nextPage: null, items: [later] });
  });
  assert.deepEqual(calls, ["/api/inventory?page=1", "/api/inventory?page=2"]);
  assert.deepEqual(filtrarItens(items, "SEGUNDA-PAGINA", "ruptura"), [later]);
});

it("catálogo não apresenta uma primeira página como resultado completo após falha e respeita cancelamento", async () => {
  await assert.rejects(carregarCatalogo(undefined, async url => String(url).endsWith("=1")
    ? Response.json({ page: 1, nextPage: 2, items: [item] }) : new Response(null, { status: 503 })), /carregar o inventário/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(carregarCatalogo(controller.signal, async () => { assert.fail("Não deve consultar"); }));
});
