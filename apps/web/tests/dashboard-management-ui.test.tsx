import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { Window } from "happy-dom";
import type { DashboardSummary, OnlineOrder } from "../src/app/sales/data";
import type { DashboardData } from "../src/app/dashboard/data";

const browser = new Window({ url: "http://localhost:3000/dashboard" }), originalFetch = globalThis.fetch;
const globals = { window: browser, self: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const requireTest = createRequire(__filename), css = requireTest.extensions[".css"];
let createRoot: typeof CreateRoot, Dashboard: typeof import("../src/app/dashboard/CommercialDashboard").default;
before(async () => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  requireTest.extensions[".css"] = module => { module.exports = {}; }; createRoot = (await import("react-dom/client")).createRoot;
  Dashboard = requireTest("../src/app/dashboard/CommercialDashboard").default;
});
beforeEach(() => browser.localStorage.clear());
after(async () => {
  globalThis.fetch = originalFetch; if (css) requireTest.extensions[".css"] = css; else delete requireTest.extensions[".css"];
  for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  await browser.happyDOM.close();
});
const session = { usuarioId: 1, loja: { id: 10, nomeLoja: "Loja de teste" }, vendasExternasHabilitadas: true, pedidosOnlineHabilitados: true };
const item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "9", sku: "L-9", preco: 9999, quantidade: 0, ruptura: true, imagemUrl: "/luva.jpg" };
const inventory: DashboardData = { produtos: 2, produtosBaixos: 1, variantes: 3, semEstoque: 2, emRuptura: 2, semControle: 1, negativas: 1, recentes: [], catalogo: [item, { ...item, id: "100:102", varianteId: "102", quantidade: -1 }, { ...item, id: "200:201", produtoId: "200", varianteId: "201", quantidade: null }] };
function summary(period: string): DashboardSummary { return { periodo: period, fuso: "America/Sao_Paulo", inicio: `${period}-01T03:00:00Z`, fim: "2026-12-01T03:00:00Z", totais: [{ moeda: "BRL", canal: "WhatsApp", vendas: 3, valorVendido: "1500.00", recebimentos: "700.00", estornos: "50.00", recebidoLiquido: "650.00", pagamentosPendentes: 2 }, { moeda: "USD", canal: "Presencial", vendas: 1, valorVendido: "30.00", recebimentos: "0.00", estornos: "0.00", recebidoLiquido: "0.00", pagamentosPendentes: 1 }], estoque: { pendentes: 2, incertas: 1 }, diario: [{ dia: `${period}-01`, moeda: "BRL", valor: "1500.00" }, { dia: `${period}-01`, moeda: "USD", valor: "30.00" }],
  gestao: { porMoeda: [{ moeda: "BRL", valorAReceber: "900.00", unidades: "8" }, { moeda: "USD", valorAReceber: "30.00", unidades: "1" }], produtosMaisVendidos: [{ moeda: "BRL", produtoId: "100", nome: "Luva", unidades: "6" }, { moeda: "BRL", produtoId: "200", nome: "Luva", unidades: "2" }], vendasComPendencia: 2 } }; }
function order(period: string, id = "1", value = "200.00"): OnlineOrder { return { id, storeId: "123", numero: id, origem: "nuvemshop", canal: "loja_online", criadoEm: `${period}-01T12:00:00Z`, status: "open", pagamento: "pending", moeda: "BRL", valorProdutos: value, totalPedido: "9999.00" }; }
async function mount() {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(() => root.render(<Dashboard inventory={inventory} limit={2} />));
  return { container, async click(text: string) { await act(() => [...container.querySelectorAll("button")].find(button => button.textContent === text)!.click()); },
    async fill(label: string, value: string) { const field = [...container.querySelectorAll("label")].find(row => row.textContent!.startsWith(label))!.querySelector("input,select")!;
      await act(() => { Object.getOwnPropertyDescriptor(field.tagName === "SELECT" ? browser.HTMLSelectElement.prototype : browser.HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new browser.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event); }); },
    card(title: string) { return [...container.querySelectorAll("article")].find(row => row.querySelector("h2")?.textContent === title)!; },
    async close() { await act(() => root.unmount()); container.remove(); } };
}
function mock(options: { more?: boolean; externalError?: boolean; onlineError?: boolean; legacy?: boolean; empty?: boolean; disabled?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method ?? "GET", "GET"); calls.push(String(url));
    if (url === "/api/auth/session") return Response.json(options.disabled ? { ...session, vendasExternasHabilitadas: false, pedidosOnlineHabilitados: false } : session);
    const parsed = new URL(`http://localhost${url}`), period = parsed.searchParams.get("periodo")!;
    if (String(url).includes("external/summary")) {
      if (options.externalError) return Response.json({ message: "Indisponível." }, { status: 503 });
      const data = summary(period); if (options.legacy) delete data.gestao;
      if (options.empty) { data.totais = []; data.diario = []; data.gestao = { porMoeda: [], produtosMaisVendidos: [], vendasComPendencia: 0 }; }
      return Response.json(data);
    }
    if (options.onlineError) return Response.json({}, { status: 503 });
    const page = Number(parsed.searchParams.get("page")), items = options.empty ? [] : page === 1 ? [order(period), { ...order(period, "cancelled"), status: "cancelled" }, { ...order(period, "usd", "20.00"), moeda: "USD" }] : [order(period), order(period, "2", "300.00")];
    return Response.json({ periodo: period, page, hasMore: options.more === true && page === 1, items });
  }; return calls;
}
it("mostra números primeiro, gráficos visíveis e atenção ao final, separando a abrangência dos seis cartões", async () => {
  const calls = mock(), view = await mount();
  try {
    assert.match(view.card("Valor vendido").textContent!, /R\$ 1\.700,00/); assert.match(view.card("Recebido nas vendas externas").textContent!, /R\$ 650,00/);
    assert.match(view.card("A receber nas vendas externas").textContent!, /R\$ 900,00/); assert.match(view.card("Vendas e pedidos").textContent!, /Vendas externas: 3Pedidos online: 1/);
    assert.match(view.card("Unidades vendidas").textContent!, /8Somente vendas externas/); assert.match(view.card("Produtos com estoque baixo").textContent!, /1Estoque atual.*2 variantes/);
    const text = view.container.textContent!; assert.ok(text.indexOf("Principais") < 0); assert.ok(text.indexOf("Valor vendido") < text.indexOf("Vendas no período")); assert.ok(text.indexOf("Produtos mais vendidos") < text.indexOf("Precisa de atenção"));
    assert.match(text, /2 vendas precisam de atenção/); assert.equal(view.container.querySelector('[aria-label="Vendas no período"]')!.closest("details"), null);
    assert.equal(view.container.querySelectorAll("svg[aria-describedby]").length, 1); assert.ok(view.container.querySelector("svg desc"));
    assert.ok(calls.every(url => !/stock-decreases|execute|financial-events/.test(url)));
  } finally { await view.close(); }
});
it("ranking agrupa por ID, usa unidades históricas e trata imagem quebrada", async () => {
  mock(); const view = await mount();
  try {
    const ranking = view.container.querySelector('[aria-label="Produtos mais vendidos"]')!;
    assert.match(ranking.textContent!, /Somente vendas externas/); assert.equal(ranking.querySelectorAll("li").length, 2);
    assert.ok(ranking.querySelector('a[href="/productDetails/100"]')); assert.ok(ranking.querySelector('a[href="/productDetails/200"]'));
    assert.match(ranking.textContent!, /6 unidades/); assert.doesNotMatch(ranking.textContent!, /9.999/);
    const image = ranking.querySelector("img")!; await act(() => image.dispatchEvent(new browser.Event("error") as unknown as Event)); assert.ok(ranking.querySelector('[aria-label="Luva, sem foto"]'));
  } finally { await view.close(); }
});
it("paginação mantém totais parciais visíveis e deduplica pedidos já carregados", async () => {
  const calls = mock({ more: true }), view = await mount();
  try {
    const warning = [...view.container.querySelectorAll('[role="alert"]')].find(row => row.textContent!.includes("Dados incompletos"))!; assert.ok(warning); assert.equal(warning.closest("details"), null);
    await view.click("Carregar mais pedidos"); assert.match(view.card("Valor vendido").textContent!, /R\$ 2\.000,00/); assert.match(view.card("Vendas e pedidos").textContent!, /Pedidos online: 2/);
    assert.ok(calls.some(url => url.endsWith("page=2"))); assert.ok(![...view.container.querySelectorAll("button")].some(row => row.textContent === "Carregar mais pedidos"));
  } finally { await view.close(); }
});
it("período mensal e moeda mudam os cartões e gráficos sem somar BRL com USD", async () => {
  const calls = mock(), view = await mount();
  try {
    await view.fill("Moeda", "USD"); assert.match(view.card("Valor vendido").textContent!, /USD 50,00/); assert.match(view.card("Unidades vendidas").textContent!, /1Somente vendas externas/);
    assert.equal(view.container.querySelectorAll("svg[aria-describedby]").length, 1); assert.match(view.container.querySelector("figcaption")!.textContent!, /USD/);
    await view.fill("Período", "2025-02"); assert.ok(calls.some(url => url.includes("periodo=2025-02"))); assert.match(view.container.textContent!, /fevereiro de 2025/);
    await view.click("Este mês"); assert.equal(view.container.querySelector('button[aria-pressed="true"]')!.textContent, "Este mês");
    assert.ok(!view.container.textContent!.includes("Últimos 7 dias"));
  } finally { await view.close(); }
});
it("backend anterior e fontes indisponíveis não inventam zeros; fontes conhecidas continuam utilizáveis", async () => {
  for (const options of [{ legacy: true }, { externalError: true }, { onlineError: true }]) {
    mock(options); const view = await mount();
    try {
      if (options.legacy || options.externalError) { assert.match(view.card("A receber nas vendas externas").textContent!, /Indisponível/); assert.match(view.card("Unidades vendidas").textContent!, /Indisponível/); }
      if (options.externalError) { assert.match(view.card("Recebido nas vendas externas").textContent!, /Indisponível/); assert.match(view.card("Valor vendido").textContent!, /R\$ 200,00Somente pedidos online/); }
      if (options.onlineError) { assert.match(view.card("Valor vendido").textContent!, /R\$ 1\.500,00Somente vendas externas/); assert.match(view.container.textContent!, /Pedidos online ainda não disponíveis/); }
    } finally { await view.close(); }
  }
});
it("estado vazio comprovado mostra zeros e mensagens próprias; flags desativadas mantêm somente estoque", async () => {
  mock({ empty: true }); let view = await mount();
  try {
    assert.match(view.card("Valor vendido").textContent!, /R\$ 0,00/); assert.match(view.card("Unidades vendidas").textContent!, /0Somente vendas externas/); assert.match(view.container.textContent!, /Nenhum produto vendido no período/);
    await view.close(); const calls = mock({ disabled: true }); view = await mount(); assert.deepEqual(calls, ["/api/auth/session"]);
    assert.match(view.card("Valor vendido").textContent!, /Indisponível/); assert.match(view.card("Produtos com estoque baixo").textContent!, /1Estoque atual/);
  } finally { await view.close(); }
});
