import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, after, it } from "node:test";
import React, { act, StrictMode } from "react";
import type { createRoot as Factory } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";

const browser = new Window({ url: "http://localhost:3000/activate" }), originalFetch = globalThis.fetch;
const globals = { window: browser, document: browser.document, navigator: browser.navigator, self: browser, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true };
const descriptors = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const requireTest = createRequire(__filename), previousCss = requireTest.extensions[".css"];
let createRoot: typeof Factory, Activate: typeof import("../src/app/activate/page").default;
let Router: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
before(async () => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  Object.defineProperty(browser.document, "visibilityState", { configurable: true, value: "visible" });
  requireTest.extensions[".css"] = module => { module.exports = {}; };
  createRoot = (await import("react-dom/client")).createRoot;
  Activate = requireTest("../src/app/activate/page").default;
  Router = requireTest("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
});
after(async () => {
  globalThis.fetch = originalFetch; if (previousCss) requireTest.extensions[".css"] = previousCss; else delete requireTest.extensions[".css"];
  for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  await browser.happyDOM.close();
});
async function settle() { await new Promise(resolve => setTimeout(resolve, 20)); }
async function mount(element: React.ReactNode) {
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: "teste" };
  await act(async () => { root.render(<Router.Provider value={router}>{element}</Router.Provider>); await settle(); });
  return { container,
    async click(text: string) { const button = [...container.querySelectorAll("button")].find(button => button.textContent?.includes(text)); assert.ok(button, text); await act(async () => { button.click(); await settle(); }); },
    async fill(text: string, value: string) {
      const label = [...container.querySelectorAll("label")].find(label => label.textContent?.startsWith(text)); assert.ok(label, text);
      const field = label.querySelector("input,select,textarea"); assert.ok(field);
      await act(async () => {
        const prototype = field.tagName === "INPUT" ? browser.HTMLInputElement.prototype : field.tagName === "SELECT" ? browser.HTMLSelectElement.prototype : browser.HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true })); await settle();
      });
    },
    async submit() { const form = container.querySelector("form"); assert.ok(form); await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(); }); },
    async close() { await act(() => root.unmount()); container.remove(); browser.localStorage.clear(); } };
}
it("convite usa fragmento e POST, inclusive em StrictMode; senha nunca aparece na URL ou no HTML inicial", async () => {
  const html = renderToStaticMarkup(<Activate />); assert.match(html, /method="post"/); assert.match(html, /disabled/); assert.doesNotMatch(html, /name="(?:password|confirmation)"/);
  const code = "a".repeat(64); browser.history.replaceState(null, "", `/activate#codigo=${code}`);
  const calls: { path: string; body: Record<string, string> }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, "POST"); assert.ok(!String(url).includes(code));
    const body = JSON.parse(String(init.body)); calls.push({ path: String(url), body }); assert.equal(body.codigo, code);
    return Response.json(String(url).endsWith("inspect") ? { email: "felipe@example.test" } : { message: "Conta criada" }, { status: String(url).endsWith("inspect") ? 200 : 201 });
  };
  const view = await mount(<StrictMode><Activate /></StrictMode>);
  try {
    assert.equal(browser.location.hash, ""); await view.fill("Nome", "Felipe"); await view.fill("Senha", "senha-local-segura"); await view.fill("Confirmar senha", "senha-local-segura"); await view.submit();
    assert.match(view.container.textContent!, /Conta criada/); assert.ok(!browser.location.href.includes("senha-local-segura"));
    assert.equal(calls.filter(call => call.path.endsWith("activate")).length, 1);
    assert.equal(calls.at(-1)!.body.password, "senha-local-segura");
  } finally { await view.close(); }
});
