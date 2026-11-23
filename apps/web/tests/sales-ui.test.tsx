import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { Window } from "happy-dom";

const browser = new Window({ url: "http://localhost:3000/sales" });
const originalFetch = globalThis.fetch;
const globals = { window: browser, self: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const requireTest = createRequire(__filename), css = requireTest.extensions[".css"];
let createRoot: typeof CreateRoot;
let Sales: typeof import("../src/app/sales/page").default;
let Dashboard: typeof import("../src/app/dashboard/CommercialDashboard").default;
let Financial: typeof import("../src/app/sales/FinancialForm").default;
let Context: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
const router = { bfcacheId: "sales-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const session = { usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, vendasExternasHabilitadas: true, pedidosOnlineHabilitados: true, baixasHabilitadas: true };
const item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "9", sku: "LUVA", preco: 10, quantidade: 8, ruptura: false };
const sale = { id: 1, usuarioId: 1, requisicaoId: "11111111-1111-4111-8111-111111111111", origem: "portero" as const, canal: "WhatsApp", formaPagamento: "Pix", moeda: "BRL", vendidaEm: "2026-11-01T12:00:00Z", situacao: "confirmada", situacaoPagamento: "pendente",
  subtotal: "10.00", descontosItens: "0.00", descontoVenda: "0.00", total: "10.00", valorRecebido: "0.00", valorEstornado: "0.00", estoque: "pendente", exigeConferencia: false,
  itens: [{ id: 100, produtoId: "100", varianteId: "101", nomeProduto: "Luva", nomeVariante: "9", sku: "LUVA", quantidade: 1, precoUnitario: "10.00", desconto: "0.00", total: "10.00", baixaId: null, estoque: "nao_solicitada" }], movimentos: [] };

before(async () => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  requireTest.extensions[".css"] = module => { module.exports = {}; };
  createRoot = (await import("react-dom/client")).createRoot;
  Sales = requireTest("../src/app/sales/page").default;
  Dashboard = requireTest("../src/app/dashboard/CommercialDashboard").default;
  Financial = requireTest("../src/app/sales/FinancialForm").default;
  Context = requireTest("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
});
beforeEach(() => browser.localStorage.clear());
after(async () => {
  globalThis.fetch = originalFetch;
  if (css) requireTest.extensions[".css"] = css; else delete requireTest.extensions[".css"];
  for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  await browser.happyDOM.close();
});
async function mount(view: React.ReactNode) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<Context.Provider value={router}>{view}</Context.Provider>));
  async function click(text: string) { await act(() => [...container.querySelectorAll("button")].find(button => button.textContent === text)!.click()); }
  async function fill(prefix: string, value: string) {
    const input = [...container.querySelectorAll("label")].find(label => label.textContent!.startsWith(prefix))!.querySelector("input,select")!;
    await act(() => {
      const prototype = input.tagName === "SELECT" ? browser.HTMLSelectElement.prototype : browser.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new browser.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event);
    });
  }
  async function submit() { await act(() => container.querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event)); }
  return { container, click, fill, submit, async close() { await act(() => root.unmount()); container.remove(); } };
}
it("perda da criação conserva a chave e o corpo; reenvio salva ID sem executar estoque automaticamente", async () => {
  const attempts: { key: string | null; body: string }[] = []; let fail = true;
  globalThis.fetch = async (url, init) => {
    if (url === "/api/auth/session") return Response.json(session);
    if (url === "/api/inventory?page=1") return Response.json({ page: 1, nextPage: null, items: [item] });
    if (url === "/api/sales/external?page=1") return Response.json({ page: 1, hasMore: false, items: [] });
    assert.equal(url, "/api/sales/external"); assert.equal(init?.method, "POST");
    const saved = JSON.parse(browser.localStorage.getItem("portero:venda:10:1")!);
    assert.equal(saved.key, new Headers(init?.headers).get("Idempotency-Key"));
    attempts.push({ key: saved.key, body: init?.body as string });
    if (fail) throw new Error("Resposta perdida");
    return Response.json(sale);
  };
  const view = await mount(<Sales />);
  try {
    await view.fill("Produto e variante", "100:101"); await view.click("Adicionar item");
    await view.fill("Canal", "WhatsApp"); await view.fill("Forma de pagamento", "Pix"); await view.fill("Data da venda", "2026-11-01T12:00");
    await view.submit(); assert.ok(browser.localStorage.getItem("portero:venda:10:1"));
    assert.match(view.container.textContent!, /requisição salva/);
    fail = false; await view.submit();
    assert.deepEqual(attempts[0], attempts[1]); assert.equal(browser.localStorage.getItem("portero:venda:10:1:id"), "1");
    assert.match(view.container.textContent!, /Sincronize os itens separadamente/); assert.equal(attempts.length, 2);
  } finally { await view.close(); }
});
it("movimento financeiro com resposta perdida reaproveita a chave e nunca solicita estoque", async () => {
  const attempts: string[] = []; let fail = true;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/sales/external/1/financial-events"); attempts.push(new Headers(init?.headers).get("Idempotency-Key")!);
    if (fail) throw new Error("Resposta perdida"); return Response.json(sale);
  };
  const view = await mount(<Financial sale={sale} session={session} onChange={() => {}} />);
  try {
    await view.fill("Valor", "5.00"); await view.fill("Data", "2026-11-01T12:00");
    await view.submit(); fail = false; await view.submit(); assert.equal(attempts.length, 2); assert.equal(attempts[0], attempts[1]);
    assert.match(view.container.textContent!, /Nenhuma cobrança ou alteração de estoque/);
  } finally { await view.close(); }
});
it("dashboard distingue pedidos pendentes de recebido e identifica abrangência parcial e moedas", async () => {
  globalThis.fetch = async url => {
    if (url === "/api/auth/session") return Response.json(session);
    if (String(url).includes("external/summary")) {
      const period = new URL(`http://localhost${url}`).searchParams.get("periodo");
      return Response.json({ periodo: period, fuso: "America/Sao_Paulo", inicio: "2026-11-01T03:00:00Z", fim: "2026-12-01T03:00:00Z",
        totais: [{ canal: "WhatsApp", moeda: "BRL", vendas: 1, valorVendido: "10.00", recebimentos: "5.00", estornos: "0.00", recebidoLiquido: "5.00", pagamentosPendentes: 1 }], estoque: { pendentes: 1, incertas: 0 } });
    }
    const period = new URL(`http://localhost${url}`).searchParams.get("periodo");
    return Response.json({ periodo: period, inicio: "2026-11-01T03:00:00Z", fim: "2026-12-01T03:00:00Z", page: 1, hasMore: true, recebidoNoMes: null,
      items: [{ id: "1", storeId: "123", numero: "7", origem: "nuvemshop", canal: "loja_online", criadoEm: "2026-11-01T12:00:00Z", status: "open", pagamento: "pending", moeda: "USD", valorProdutos: "20.00", totalPedido: "25.00" }] });
  };
  const view = await mount(<Dashboard />);
  try {
    assert.match(view.container.textContent!, /valor dos pedidos: USD 20,00/);
    assert.match(view.container.textContent!, /Recebido líquido no mês: BRL 5,00/);
    assert.match(view.container.textContent!, /Totais parciais/); assert.match(view.container.textContent!, /Recebido online no mês indisponível/);
  } finally { await view.close(); }
});
it("gráfico diário separa origens e moedas e sinaliza páginas online ainda não consultadas", async () => {
  globalThis.fetch = async url => {
    if (url === "/api/auth/session") return Response.json(session);
    const period = new URL(`http://localhost${url}`).searchParams.get("periodo")!;
    if (String(url).includes("external/summary")) return Response.json({ periodo: period, fuso: "America/Sao_Paulo", totais: [], estoque: { pendentes: 0, incertas: 0 }, diario: [{ dia: `${period}-01`, moeda: "BRL", valor: "10.00" }] });
    return Response.json({ periodo: period, page: 1, hasMore: true, items: [{ id: "1", storeId: "123", numero: "1", origem: "nuvemshop", canal: "loja_online", criadoEm: `${period}-01T03:00:00Z`, status: "open", pagamento: "pending", moeda: "USD", valorProdutos: "20.00", totalPedido: "99.00" }] });
  };
  const view = await mount(<Dashboard />);
  try {
    const chart = view.container.querySelector('[aria-label="Valor comercial diário"]')!; assert.ok(chart);
    assert.match(chart.textContent!, /Não representa valor recebido/); assert.match(chart.textContent!, /valores parciais/);
    assert.match(chart.textContent!, /Valor comercial diário · BRL/); assert.match(chart.textContent!, /Valor comercial diário · USD/);
    assert.equal(chart.querySelectorAll("svg").length, 2); assert.match(chart.textContent!, /BRL 10,00/); assert.match(chart.textContent!, /USD 20,00/); assert.doesNotMatch(chart.textContent!, /99,00/);
  } finally { await view.close(); }
});
it("flags desativadas não consultam a extensão nem impedem o inventário existente", async () => {
  const calls: string[] = [];
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ usuarioId: 1, loja: session.loja }); };
  const view = await mount(<Sales />);
  try { assert.deepEqual(calls, ["/api/auth/session"]); assert.match(view.container.textContent!, /ainda não ativado/); }
  finally { await view.close(); }
  calls.length = 0;
  const dashboard = await mount(<Dashboard />);
  try { assert.deepEqual(calls, ["/api/auth/session"]); assert.equal(dashboard.container.textContent, ""); }
  finally { await dashboard.close(); }
});
