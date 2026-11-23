import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { simulatedLocks } from "./locks";

const browser = new Window({ url: "http://localhost:3000/productDetails/100?varianteId=102" });
const originalFetch = globalThis.fetch;
const globals = { window: browser, self: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const requireTest = createRequire(__filename), css = requireTest.extensions[".css"];
let createRoot: typeof CreateRoot;
let Product: typeof import("../src/app/productDetails/ProductDetail").default;
let Context: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
const router = { bfcacheId: "product-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const item = { id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "9", sku: "LUVA-9", preco: 100, quantidade: 8, ruptura: false };
const other = { ...item, id: "100:102", varianteId: "102", variante: "10", sku: "LUVA-10" };
let calls: string[], stock: number, enabled: boolean, status: string;

before(async () => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  Object.defineProperty(browser.navigator, "locks", { configurable: true, value: simulatedLocks() });
  requireTest.extensions[".css"] = module => { module.exports = {}; };
  createRoot = (await import("react-dom/client")).createRoot;
  Product = requireTest("../src/app/productDetails/ProductDetail").default;
  Context = requireTest("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
});
beforeEach(() => {
  browser.localStorage.clear(); calls = []; stock = 8; enabled = true; status = "registrada";
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/auth/session") return Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, baixasHabilitadas: enabled });
    if (url === "/api/inventory/products/100") return Response.json({ produtoId: "100", nome: "Luva", items: [item, { ...other, quantidade: stock }] });
    if (url === "/api/inventory?page=1") return Response.json({ page: 1, nextPage: null, items: [item, { ...other, quantidade: stock }] });
    const operation = () => ({ baixaId: 7, produtoId: "100", varianteId: "102", quantidade: 1, statusSincronizacao: status });
    if (url === "/api/inventory/stock-decreases") {
      assert.equal(init?.method, "POST"); assert.equal(JSON.parse(init.body as string).varianteId, "102");
      return Response.json(operation(), { status: 201 });
    }
    if (url === "/api/inventory/stock-decreases/7") return Response.json(operation());
    if (url === "/api/inventory/stock-decreases/7/execute") {
      assert.equal(JSON.parse(browser.localStorage.getItem("portero:baixa:100:102")!).baixaId, 7);
      assert.equal(init?.body, "{}"); stock = 7; status = "sincronizada"; return Response.json(operation());
    }
    throw new Error(`Rota não esperada no teste: ${url}`);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (css) requireTest.extensions[".css"] = css; else delete requireTest.extensions[".css"];
  for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  await browser.happyDOM.close();
});

async function mount(varianteId = "102") {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<Context.Provider value={router}><Product produtoId="100" varianteId={varianteId} /></Context.Provider>));
  return { container, async close() { await act(() => root.unmount()); container.remove(); } };
}

it("abre a variante do inventário e permite consultar outra sem escrever no estoque", async () => {
  const view = await mount();
  try {
    assert.match(view.container.textContent!, /LUVA-10/);
    assert.equal(view.container.querySelector<HTMLAnchorElement>('a[href="/inventory"]')?.textContent, "Voltar");
    await act(() => [...view.container.querySelectorAll("button")].find(button => button.textContent === "9")!.click());
    assert.match(view.container.textContent!, /LUVA-9/); assert.ok(calls.every(call => call.startsWith("GET ")));
  } finally { await view.close(); }
});

it("a baixa dos detalhes reutiliza as duas etapas, guarda o ID e consulta novamente produto e inventário", async () => {
  const view = await mount();
  try {
    await act(() => view.container.querySelector<HTMLButtonElement>('button[aria-label="Dar baixa em Luva, variante 10"]')!.click());
    await act(() => view.container.querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
    assert.equal(calls.filter(call => call.startsWith("POST ")).length, 2);
    assert.equal(calls.filter(call => call === "GET /api/inventory/products/100").length, 2);
    assert.ok(calls.includes("GET /api/inventory?page=1")); assert.match(view.container.textContent!, /7 UN/);
    assert.match(view.container.textContent!, /Baixa confirmada/);
  } finally { await view.close(); }
});

it("não troca silenciosamente uma variante removida e mantém a flag de baixas", async () => {
  const view = await mount("999");
  try {
    assert.match(view.container.textContent!, /Selecione uma variante disponível/);
    assert.equal(view.container.querySelector('button[aria-label^="Dar baixa"]'), null);
  } finally { await view.close(); }
  enabled = false;
  const disabled = await mount();
  try { assert.equal(disabled.container.querySelector<HTMLButtonElement>('button[aria-label^="Dar baixa"]')?.disabled, true); }
  finally { await disabled.close(); }
});

it("produto excluído apresenta erro recuperável sem formulário de baixa", async () => {
  globalThis.fetch = async url => url === "/api/auth/session"
    ? Response.json({ usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" } }) : new Response(null, { status: 404 });
  const view = await mount();
  try {
    assert.match(view.container.querySelector('[role="alert"]')!.textContent!, /Produto não encontrado/);
    assert.equal(view.container.querySelector("form"), null);
  } finally { await view.close(); }
});
