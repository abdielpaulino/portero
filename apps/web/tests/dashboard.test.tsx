import assert from "node:assert/strict";
import { it } from "node:test";
import { carregarDashboard } from "../src/app/dashboard/data";
import { apiOrigin } from "../api-origin.cjs";

const item = { id: "100:1", produtoId: "100", varianteId: "1", nome: "Luva", variante: "Azul", sku: null, preco: 100, quantidade: 0, ruptura: true };
it("conta todas as páginas e separa estoque negativo e não controlado", async () => {
  const calls: string[] = [];
  const result = await carregarDashboard(undefined, async (url, init) => {
    calls.push(String(url)); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin");
    if (String(url) === "/api/inventory?page=1") return Response.json({ page: 1, nextPage: 2,
      items: [item, { ...item, id: "100:2", varianteId: "2", quantidade: null, ruptura: false }] });
    if (String(url) === "/api/inventory?page=2") return Response.json({ page: 2, nextPage: null,
      items: [{ ...item, id: "200:3", produtoId: "200", varianteId: "3", quantidade: -1, ruptura: true }] });
    return Response.json({ page: 1, hasMore: false, items: [] });
  });
  assert.deepEqual(result, { produtos: 2, variantes: 3, semEstoque: 2, emRuptura: 2, semControle: 1, negativas: 1, recentes: [] });
  assert.equal(calls.length, 3); assert.ok(!calls.some(url => /dashboard|orders|sales/.test(url)));
});
it("mantém status das cinco baixas recentes e não inventa indicadores se a API falhar", async () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, produtoId: "100", varianteId: "1", sku: null, quantidade: 2,
    status: i ? "sincronizada" : "incerta", criadoEm: "2026-11-17T12:00:00Z", usuario: { id: 1, nome: "Ana", email: "ana@example.test" } }));
  const result = await carregarDashboard(undefined, async url => Response.json(String(url).startsWith("/api/inventory?")
    ? { page: 1, nextPage: null, items: [] } : { page: 1, hasMore: false, items: history }));
  assert.equal(result.recentes.length, 5); assert.equal(result.recentes[0].status, "incerta");
  assert.equal(result.produtos, 0); assert.equal(result.negativas, 0);
  await assert.rejects(carregarDashboard(undefined, async () => new Response(null, { status: 503 })));
});
it("exige API HTTPS em produção e impede caminhos ou credenciais nos encaminhamentos", () => {
  assert.equal(apiOrigin({ NODE_ENV: "production", API_URL: "https://api.example.test" }), "https://api.example.test");
  for (const value of [undefined, "http://api.example.test", "https://api.example.test/", "https://api.example.test/path", "https://usuario:senha@api.example.test"])
    assert.throws(() => apiOrigin({ NODE_ENV: "production", API_URL: value }));
});
