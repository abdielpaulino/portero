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
