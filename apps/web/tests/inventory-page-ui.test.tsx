import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, it } from "node:test";
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

it("preserva o estoque mais recente quando duas baixas confirmadas recebem consultas fora de ordem", async () => {
  const item: Item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "Azul",
    sku: "LUVA-A", preco: 100, quantidade: 8, ruptura: false };
  const other = { ...item, id: "100:102", varianteId: "102", variante: "Vermelha", sku: "LUVA-V" };
  const reads: Array<(response: Response) => void> = [];
  const writes = new Map<string, (response: Response) => void>();
  let initial = true;
  const operation = (id: number, status = "registrada") => ({baixaId:id,produtoId:"100",varianteId:id===1?"101":"102",quantidade:1,statusSincronizacao:status});
  globalThis.fetch = async (url, init) => {
    if (url === "/api/inventory/stock-decreases" && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      return Response.json(operation(body.varianteId === "101" ? 1 : 2), {status:201});
    }
    if (String(url).startsWith("/api/inventory/stock-decreases/")) {
      const id = Number(String(url).split("/")[4]);
      if(init?.method === "POST") return new Promise<Response>(finish => writes.set(id===1?"101":"102",finish));
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
      await act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="Dar baixa em Luva, variante ${variant}"]`)!.click());
      await act(() => container.querySelector(`form[aria-label="Dar baixa em Luva, variante ${variant}"]`)!
        .dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
    }
    assert.equal(writes.size, 2);
    const confirmed = (id: number) => Response.json(operation(id, "sincronizada"));
    await act(() => writes.get("101")!(confirmed(1)));
    await act(() => writes.get("102")!(confirmed(2)));
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
    assert.equal(container.querySelector<HTMLButtonElement>('button[aria-label="Dar baixa em Luva, variante Azul"]')?.disabled, true);
    enabled = true;
    await act(() => root.unmount());
    const refreshed = createRoot(container);
    try {
      await act(() => refreshed.render(view));
      assert.equal(container.querySelector<HTMLButtonElement>('button[aria-label="Dar baixa em Luva, variante Azul"]')?.disabled, false);
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
