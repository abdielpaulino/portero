import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { Window } from "happy-dom";
import type { Item } from "../src/app/inventory/data";
import { simulatedLocks } from "./locks";

const browser = new Window({ url: "http://localhost:3000/inventory" });
const originalFetch = globalThis.fetch;
const globals = { window: browser, self: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement, Event: browser.Event,
  IS_REACT_ACT_ENVIRONMENT: true };
const descriptors = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const testRequire = createRequire(__filename);
const originalCss = testRequire.extensions[".css"];
let createRoot: typeof CreateRoot;
let InventoryPage: typeof import("../src/app/inventory/page").default;
let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;

before(async () => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  Object.defineProperty(browser.navigator, "locks", { configurable: true, value: simulatedLocks() });
  testRequire.extensions[".css"] = (module) => { module.exports = {}; };
  createRoot = (await import("react-dom/client")).createRoot;
  InventoryPage = testRequire("../src/app/inventory/page").default;
  AppRouterContext = testRequire("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
});
beforeEach(() => { browser.localStorage.clear(); browser.sessionStorage.clear(); });

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalCss) testRequire.extensions[".css"] = originalCss;
  else delete testRequire.extensions[".css"];
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  await browser.happyDOM.close();
});

for (const enabled of [true, false, undefined]) it(`navegação abre vendas externas com disponibilidade ${String(enabled)}, preservando a baixa simples`, async () => {
  const paths: string[] = [], reads: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method ?? "GET", "GET"); reads.push(String(url));
    if (url === "/api/auth/session") return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, baixasHabilitadas: true, ...(enabled === undefined ? {} : { vendasExternasHabilitadas: enabled }) });
    assert.equal(url, "/api/inventory?page=1"); return Response.json({ page: 1, nextPage: null, items: [{ id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "Azul", sku: null, preco: 10, quantidade: 8, ruptura: false }] });
  };
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const router = { bfcacheId: "sales-navigation", back() {}, forward() {}, refresh() {}, push(path: string) { paths.push(path); }, replace() {}, prefetch() {} };
  try {
    await act(() => root.render(<AppRouterContext.Provider value={router}><InventoryPage /></AppRouterContext.Provider>));
    assert.equal(container.querySelector('a[href="/sales"]'), null, "a navegação principal evita links repetidos no cabeçalho");
    assert.match(container.textContent!, /Baixa simples: somente estoque/);
    const stock = container.querySelector<HTMLButtonElement>('form[aria-label="Dar baixa em Luva, variante Azul"] button[type="submit"]'); assert.ok(stock); assert.equal(stock.disabled, false);
    const tab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(button => button.textContent === "Vendas"); assert.ok(tab);
    await act(() => tab.click()); assert.deepEqual(paths, ["/sales"]);
    assert.deepEqual(reads.sort(), ["/api/auth/session", "/api/inventory?page=1"].sort());
  } finally { await act(() => root.unmount()); container.remove(); }
});

it("preserva o estoque mais recente quando duas baixas confirmadas recebem consultas fora de ordem", async () => {
  const item: Item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "Azul",
    sku: "LUVA-A", preco: 100, quantidade: 8, ruptura: false };
  const other = { ...item, id: "200:201", produtoId: "200", varianteId: "201", variante: "Vermelha", sku: "LUVA-V" };
  const reads: Array<(response: Response) => void> = [];
  const writes = new Map<string, (response: Response) => void>();
  let initial = true;
  const operation = (id: number, status = "registrada") => ({baixaId:id,produtoId:id===1?"100":"200",varianteId:id===1?"101":"201",quantidade:1,statusSincronizacao:status});
  globalThis.fetch = async (url, init) => {
    if (url === "/api/inventory/stock-decreases" && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      return Response.json(operation(body.varianteId === "101" ? 1 : 2), {status:201});
    }
    if (String(url).startsWith("/api/inventory/stock-decreases/")) {
      const id = Number(String(url).split("/")[4]);
      if(init?.method === "POST") return new Promise<Response>(finish => writes.set(id===1?"101":"201",finish));
      return Response.json(operation(id));
    }
    if (url === "/api/auth/session") return Response.json({usuarioId:1,loja:{id:10,nomeLoja:"Demo"},baixasHabilitadas:true});
    assert.equal(url, "/api/inventory?page=1");
    if (initial) { initial = false; return Response.json({ items: [item, other], page: 1, nextPage: null }); }
    return new Promise<Response>((finish) => reads.push(finish));
  };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const router = { bfcacheId: "inventory-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  try {
    await act(() => root.render(<AppRouterContext.Provider value={router}><InventoryPage /></AppRouterContext.Provider>));
    for (const variant of ["Azul", "Vermelha"]) {
      await act(() => container.querySelector(`form[aria-label="Dar baixa em Luva, variante ${variant}"]`)!
        .dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
    }
    assert.equal(writes.size, 2);
    const confirmed = (id: number) => Response.json(operation(id, "sincronizada"));
    await act(() => writes.get("101")!(confirmed(1)));
    await act(() => writes.get("201")!(confirmed(2)));
    assert.equal(reads.length, 2);
    await act(() => reads[1](Response.json({ items: [{ ...item, quantidade: 7 }, { ...other, quantidade: 7 }], page: 1, nextPage: null })));
    assert.equal(container.textContent?.includes("8 UN"), false);
    await act(() => reads[0](Response.json({ items: [{ ...item, quantidade: 7 }, other], page: 1, nextPage: null })));
    assert.equal(container.textContent?.includes("8 UN"), false);
    assert.equal(container.textContent?.match(/7 UN/g)?.length, 2);
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});

it("recupera a verificação da sessão ao tentar novamente e mantém baixas bloqueadas quando desabilitadas", async () => {
  let sessionReads = 0;
  let enabled = false;
  const item: Item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "Azul",
    sku: null, preco: 100, quantidade: 8, ruptura: false };
  globalThis.fetch = async (url, init) => {
    assert.notEqual(init?.method, "POST");
    if (url === "/api/auth/session") {
      if (++sessionReads === 1) return new Response(null, { status: 503 });
      return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Loja" }, baixasHabilitadas: enabled });
    }
    assert.equal(url, "/api/inventory?page=1");
    return Response.json({ items: [item], page: 1, nextPage: null });
  };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const router = { bfcacheId: "inventory-retry-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  const view = <AppRouterContext.Provider value={router}><InventoryPage /></AppRouterContext.Provider>;
  try {
    await act(() => root.render(view));
    assert.ok(container.textContent?.includes("Não foi possível verificar sua sessão"));
    await act(() => [...container.querySelectorAll("button")].find(button => button.textContent === "Tentar novamente")!.click());
    assert.equal(sessionReads, 2);
    assert.ok(container.textContent?.includes("Baixas desabilitadas"));
    assert.equal(container.querySelector<HTMLButtonElement>('form[aria-label="Dar baixa em Luva, variante Azul"] button[type="submit"]')?.disabled, true);
    enabled = true;
    await act(() => root.unmount());
    const refreshed = createRoot(container);
    try {
      await act(() => refreshed.render(view));
      assert.equal(container.querySelector<HTMLButtonElement>('form[aria-label="Dar baixa em Luva, variante Azul"] button[type="submit"]')?.disabled, false);
    } finally { await act(() => refreshed.unmount()); }
  } finally { await act(() => root.unmount()); container.remove(); }
});

it("pesquisa a segunda página, abre a variante correta e renova o saldo ao retornar à aba", async () => {
  const item: Item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva primeira", variante: "9", sku: "SKU-1", preco: 100, quantidade: 8, ruptura: false };
  const later = { ...item, id: "200:201", produtoId: "200", varianteId: "201", nome: "Luva segunda", sku: "SKU-PAGINA-2", quantidade: -2, ruptura: true };
  let stock = 8, pages = 0;
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  globalThis.fetch = async (url, init) => {
    assert.notEqual(init?.method, "POST");
    if (url === "/api/auth/session") return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, baixasHabilitadas: true });
    pages++;
    return Response.json(url === "/api/inventory?page=1"
      ? { page: 1, nextPage: 2, items: [{ ...item, quantidade: stock }] }
      : { page: 2, nextPage: null, items: [later] });
  };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const router = { bfcacheId: "catalog-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  async function search(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(() => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event);
    });
  }
  try {
    await act(() => root.render(<AppRouterContext.Provider value={router}><InventoryPage /></AppRouterContext.Provider>));
    assert.equal(pages, 2);
    assert.ok(container.querySelector('a[href="/productDetails/200?varianteId=201"]'));
    assert.match(container.textContent!, /Estoque negativo/);
    await search("SKU-PAGINA-2");
    assert.match(container.textContent!, /Luva segunda/); assert.ok(!container.textContent!.includes("Luva primeira"));
    await search(""); stock = 6;
    await act(() => window.dispatchEvent(new browser.Event("focus") as unknown as Event));
    assert.equal(pages, 4); assert.match(container.textContent!, /6 UN/);
  } finally {
    await act(() => root.unmount()); container.remove();
    if (visibility) Object.defineProperty(document, "visibilityState", visibility); else Reflect.deleteProperty(document, "visibilityState");
  }
});

const groupedItem: Item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "9", sku: "LUVA-9", preco: 100, quantidade: 8, ruptura: false };
const groupedVariant: Item = { ...groupedItem, id: "100:102", varianteId: "102", variante: "10", sku: "LUVA-10", preco: 120, quantidade: 4 };
function mockCatalog(items: Item[], handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = async (url, init) => {
    if (url === "/api/auth/session") return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, baixasHabilitadas: true });
    if (url === "/api/inventory?page=1") return Response.json({ page: 1, nextPage: null, items });
    if (handler) return handler(String(url), init);
    assert.fail(`Consulta inesperada: ${String(url)}`);
  };
}
async function groupedView() {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const router = { bfcacheId: "grouped-inventory", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  await act(() => root.render(<AppRouterContext.Provider value={router}><InventoryPage /></AppRouterContext.Provider>));
  const card = (id = "100") => container.querySelector<HTMLElement>(`article[data-product-id="${id}"]`)!;
  async function fill(element: HTMLInputElement | HTMLSelectElement, value: string) {
    await act(() => {
      const prototype = element.tagName === "SELECT" ? browser.HTMLSelectElement.prototype : browser.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new browser.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event);
    });
  }
  return { container, card, fill,
    select(value: string, id = "100") { return fill(card(id).querySelector("select")!, value); },
    quantity(value: string) { return fill(card().querySelector('input[type="number"]')!, value); },
    async submit() { await act(() => card().querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event)); },
    async close() { await act(() => root.unmount()); container.remove(); },
  };
}

it("exibe um cartão por ID, troca metadados e disponibilidade e encontra SKUs de variantes", async () => {
  const zero = { ...groupedVariant, quantidade: 0, ruptura: true };
  const unlimited = { ...groupedItem, id: "100:103", varianteId: "103", variante: "11", sku: null, preco: null, quantidade: null };
  const sameName = { ...groupedItem, id: "200:201", produtoId: "200", varianteId: "201" };
  mockCatalog([groupedItem, zero, unlimited, sameName]);
  const view = await groupedView();
  try {
    assert.equal(view.container.querySelectorAll("article[data-product-id]").length, 2);
    assert.equal(view.card().querySelectorAll('input[type="number"]').length, 1);
    assert.equal(view.card().querySelectorAll("select option").length, 3);
    await view.select("102");
    assert.match(view.card().textContent!, /SKU: LUVA-10/); assert.match(view.card().textContent!, /120,00/);
    assert.match(view.card().textContent!, /0 UN/); assert.match(view.card().textContent!, /Sem estoque/);
    assert.ok(view.card().querySelector('a[href="/productDetails/100?varianteId=102"]'));
    await view.select("103");
    assert.match(view.card().textContent!, /SKU: —/); assert.match(view.card().textContent!, /Sob consulta/);
    assert.match(view.card().textContent!, /Sem controle/);
    await view.fill(view.container.querySelector('input[aria-label="Buscar produtos, variantes ou SKUs"]')!, "LUVA-10");
    assert.equal(view.container.querySelectorAll("article[data-product-id]").length, 1);
    assert.equal(view.card().querySelector<HTMLSelectElement>("select")!.value, "102");
    assert.match(view.card().textContent!, /0 UN/);
  } finally { await view.close(); }
});

it("variantes de páginas posteriores ficam no mesmo cartão e continuam pesquisáveis", async () => {
  const items = Array.from({ length: 61 }, (_, index) => ({ ...groupedItem, id: `100:${101 + index}`, varianteId: String(101 + index), variante: `Tamanho ${index + 1}`, sku: `TAMANHO-${index + 1}` }));
  const pages: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.notEqual(init?.method, "POST");
    if (url === "/api/auth/session") return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, baixasHabilitadas: true });
    pages.push(String(url));
    return Response.json(url === "/api/inventory?page=1" ? { page: 1, nextPage: 2, items: items.slice(0, 35) } : { page: 2, nextPage: null, items: items.slice(35) });
  };
  const view = await groupedView();
  try {
    assert.deepEqual(pages, ["/api/inventory?page=1", "/api/inventory?page=2"]);
    assert.equal(view.container.querySelectorAll("article[data-product-id]").length, 1);
    assert.equal(view.card().querySelectorAll("select option").length, 61);
    assert.match(view.container.querySelector('nav[aria-label="Páginas do catálogo"]')!.textContent!, /Página 1 de 1/);
    await view.fill(view.container.querySelector('input[aria-label="Buscar produtos, variantes ou SKUs"]')!, "TAMANHO-61");
    assert.equal(view.card().querySelector<HTMLSelectElement>("select")!.value, "161");
    assert.equal(view.card().querySelectorAll("select option").length, 1);
    assert.match(view.card().textContent!, /SKU: TAMANHO-61/);
  } finally { await view.close(); }
});

it("envia produto, variante e quantidade selecionados e impede troca durante a execução", async () => {
  const calls: { url: string; body: unknown }[] = [];
  let complete: ((response: Response) => void) | undefined;
  const operation = { baixaId: 31, produtoId: "100", varianteId: "102", quantidade: 2, statusSincronizacao: "registrada" };
  mockCatalog([groupedItem, groupedVariant], (url, init) => {
    if (init?.method === "POST") {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith("/execute")) return new Promise<Response>(resolve => { complete = resolve; });
      return Response.json(operation, { status: 201 });
    }
    assert.equal(url, "/api/inventory/stock-decreases/31"); return Response.json(operation);
  });
  const view = await groupedView();
  try {
    await view.quantity("6"); await view.select("102");
    assert.equal(view.card().querySelector<HTMLInputElement>('input[type="number"]')!.value, "1");
    await view.quantity("2"); await view.submit(); assert.ok(complete);
    assert.deepEqual(calls[0], { url: "/api/inventory/stock-decreases", body: { produtoId: "100", varianteId: "102", quantidade: 2 } });
    assert.equal(view.card().querySelector<HTMLSelectElement>("select")!.disabled, true);
    assert.equal(view.container.querySelector<HTMLInputElement>('input[aria-label="Buscar produtos, variantes ou SKUs"]')!.disabled, true);
    await view.select("101");
    assert.ok(view.card().querySelector('form[aria-label="Dar baixa em Luva, variante 10"]'));
    assert.equal(JSON.parse(browser.localStorage.getItem("portero:baixa:100:102")!).baixaId, 31);
    await act(() => complete!(Response.json({ ...operation, statusSincronizacao: "sincronizada" })));
    assert.deepEqual(calls[1], { url: "/api/inventory/stock-decreases/31/execute", body: {} });
    assert.equal(calls.length, 2); assert.match(view.container.textContent!, /Baixa confirmada/);
  } finally { await view.close(); }
});

it("resposta de criação perdida permanece na variante original, inclusive depois de trocar e remontar", async () => {
  const calls: string[] = [];
  mockCatalog([groupedItem, groupedVariant], (url, init) => {
    assert.equal(url, "/api/inventory/stock-decreases"); assert.equal(init?.method, "POST"); calls.push(String(init?.body));
    throw new Error("Resposta perdida");
  });
  const view = await groupedView();
  try {
    await view.quantity("3"); await view.submit(); assert.equal(calls.length, 1);
    const saved = browser.localStorage.getItem("portero:baixa:100:101"); assert.ok(saved);
    await view.select("102");
    assert.equal(view.card().querySelector<HTMLInputElement>('input[type="number"]')!.value, "1");
    assert.equal(view.card().querySelector<HTMLInputElement>('input[type="number"]')!.readOnly, false);
    assert.equal(browser.localStorage.getItem("portero:baixa:100:102"), null);
    await view.select("101");
    assert.equal(view.card().querySelector<HTMLInputElement>('input[type="number"]')!.value, "3");
    assert.equal(view.card().querySelector<HTMLInputElement>('input[type="number"]')!.readOnly, true);
    assert.equal(view.card().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
    assert.ok(view.card().querySelector('a[href="/history"]'));
    assert.equal(browser.localStorage.getItem("portero:baixa:100:101"), saved);
  } finally { await view.close(); }
  const remounted = await groupedView();
  try {
    assert.equal(remounted.card().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
    assert.match(remounted.card().textContent!, /Criação sem ID confirmado/); assert.equal(calls.length, 1);
  } finally { await remounted.close(); }
});

it("operação incerta não passa para outra variante e seu mesmo ID é apenas consultado ao retornar", async () => {
  const pending = { produtoId: "100", varianteId: "101", quantidade: 2, baixaId: 40 };
  browser.localStorage.setItem("portero:baixa:100:101", JSON.stringify(pending));
  const reads: string[] = [], writes: { url: string; body: unknown }[] = [];
  const otherOperation = { baixaId: 41, produtoId: "100", varianteId: "102", quantidade: 1, statusSincronizacao: "registrada" };
  mockCatalog([groupedItem, groupedVariant], (url, init) => {
    if (init?.method === "POST") {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json(url.endsWith("/execute") ? { ...otherOperation, statusSincronizacao: "sincronizada" } : otherOperation, { status: url.endsWith("/execute") ? 200 : 201 });
    }
    reads.push(url);
    return Response.json(url.endsWith("/40") ? { ...pending, statusSincronizacao: "incerta" } : otherOperation);
  });
  const view = await groupedView();
  try {
    assert.match(view.card().textContent!, /Operação #40/);
    await view.select("102"); assert.doesNotMatch(view.card().textContent!, /Operação #40/);
    await view.submit(); assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].body, { produtoId: "100", varianteId: "102", quantidade: 1 });
    assert.ok(writes[1].url.endsWith("/41/execute"));
    await view.select("101"); await view.submit();
    assert.equal(writes.length, 2); assert.equal(reads.at(-1), "/api/inventory/stock-decreases/40");
    assert.match(view.card().textContent!, /Solicite conferência/);
    assert.deepEqual(JSON.parse(browser.localStorage.getItem("portero:baixa:100:101")!), pending);
  } finally { await view.close(); }
});

it("remoção da variante selecionada não escolhe nem executa outra silenciosamente", async () => {
  let items = [groupedItem, groupedVariant];
  globalThis.fetch = async url => {
    if (url === "/api/auth/session") return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, baixasHabilitadas: true });
    assert.equal(url, "/api/inventory?page=1"); return Response.json({ page: 1, nextPage: null, items });
  };
  const view = await groupedView();
  try {
    await view.select("102"); items = [groupedItem];
    await act(() => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Atualizar estoque")!.click());
    assert.match(view.card().textContent!, /variante selecionada não está mais disponível/);
    assert.equal(view.card().querySelector("form"), null);
    assert.equal(view.card().querySelector<HTMLSelectElement>("select")!.value, "");
    await view.select("101"); assert.ok(view.card().querySelector("form"));
  } finally { await view.close(); }
});

it("pendência inválida bloqueia o formulário da sua variante sem contaminar as demais", async () => {
  browser.localStorage.setItem("portero:baixa:100:101", "registro inválido");
  mockCatalog([groupedItem, groupedVariant]);
  const view = await groupedView();
  try {
    assert.match(view.card().textContent!, /Pendência inválida/);
    assert.equal(view.card().querySelector("form"), null);
    assert.ok(view.card().querySelector('a[href="/history"]'));
    await view.select("102"); assert.ok(view.card().querySelector("form"));
    await view.select("101"); assert.equal(view.card().querySelector("form"), null);
    assert.equal(browser.localStorage.getItem("portero:baixa:100:101"), "registro inválido");
  } finally { await view.close(); }
});
