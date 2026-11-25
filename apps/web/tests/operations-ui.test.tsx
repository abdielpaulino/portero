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
let createRoot: typeof Factory, Activate: typeof import("../src/app/activate/page").default, Settings: typeof import("../src/app/settings/page").default;
let Conference: typeof import("../src/app/history/Conference").default, Inventory: typeof import("../src/app/inventory/page").default;
let Router: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
before(async () => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  Object.defineProperty(browser.document, "visibilityState", { configurable: true, value: "visible" });
  requireTest.extensions[".css"] = module => { module.exports = {}; };
  createRoot = (await import("react-dom/client")).createRoot;
  Activate = requireTest("../src/app/activate/page").default; Settings = requireTest("../src/app/settings/page").default;
  Conference = requireTest("../src/app/history/Conference").default; Inventory = requireTest("../src/app/inventory/page").default;
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
const session = { usuarioId: 1, loja: { id: 10, nomeLoja: "Demo" }, configuracoesHabilitadas: true, conferenciasHabilitadas: true, baixasHabilitadas: false };
const prefs = { limiteRuptura: 3, notificacoesAtivas: false, emailNotificacoes: "felipe@example.test", atualizacaoAutomatica: true, intervaloSegundos: 60, versao: 1, envioConfigurado: false, alertas: [] };
it("configurações carregam valores persistidos, salvam versão e não anunciam envio sem configuração", async () => {
  const saved: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    if (url === "/api/auth/session") return Response.json(session);
    assert.equal(url, "/api/settings");
    if (init?.method === "PUT") { saved.push(JSON.parse(String(init.body))); return Response.json({ ...prefs, ...saved.at(-1), versao: 2 }); }
    return Response.json(prefs);
  };
  const view = await mount(<Settings />);
  try {
    await act(settle); await view.fill("Destinatário", "outro@example.test"); await view.click("Salvar preferências");
    assert.equal(saved[0].emailNotificacoes, "outro@example.test"); assert.equal(saved[0].versao, 1); assert.match(view.container.textContent!, /Preferências salvas/);
    assert.match(view.container.textContent!, /Envio de notificações ainda não configurado/); assert.match(view.container.textContent!, /tela fechada/);
  } finally { await view.close(); }
});
it("conferência com resposta perdida guarda chave e evidência; recuperação não executa estoque", async () => {
  const calls: { key: string; body: string }[] = []; let fail = true;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/inventory/stock-decreases/7/reviews");
    if (init?.method !== "POST") return Response.json({ items: [] });
    const saved = browser.localStorage.getItem("portero:conferencia:10:1:7"); assert.ok(saved);
    calls.push({ key: new Headers(init.headers).get("Idempotency-Key")!, body: String(init.body) });
    if (fail) throw new Error("Resposta perdida"); return Response.json({ id: 1, status: "incerta" });
  };
  const view = await mount(<Conference item={{ id: 7, produtoId: "100", varianteId: "101", sku: null, quantidade: 3, status: "incerta", criadoEm: "2026-11-22T12:00:00Z", usuario: { id: 1, nome: "Admin", email: "admin@example.test" } }} session={session} onChange={() => {}} />);
  try {
    await view.click("Conferências da baixa"); await view.fill("Referência", "MOVIMENTO-TESTE-123"); await view.fill("Justificativa", "Conferência administrativa sem conclusão segura.");
    const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!; await act(async () => { checkbox.click(); await settle(); });
    await view.submit(); fail = false; await view.submit(); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.match(view.container.textContent!, /não envia baixa nem repõe estoque/);
  } finally { await view.close(); }
});
it("limite persistido afeta filtros e atualização periódica só consulta com a tela visível", async () => {
  let refresh: (() => void) | undefined, reads = 0;
  const nativeInterval = browser.setInterval, nativeClear = browser.clearInterval;
  browser.setInterval = ((callback: () => void, milliseconds: number) => { assert.equal(milliseconds, 60000); refresh = callback; return 1; }) as unknown as typeof browser.setInterval;
  browser.clearInterval = (() => {}) as typeof browser.clearInterval;
  globalThis.fetch = async url => {
    if (url === "/api/auth/session") return Response.json(session);
    if (url === "/api/settings") return Response.json(prefs);
    assert.equal(url, "/api/inventory?page=1"); reads++;
    return Response.json({ page: 1, nextPage: null, items: [{ id: "100:101", produtoId: "100", varianteId: "101", nome: "Luva", variante: "Azul", sku: "LUVA", preco: 10, quantidade: reads === 1 ? 2 : 1, ruptura: false }] });
  };
  const view = await mount(<Inventory />);
  try {
    await act(settle); assert.match(view.container.textContent!, /Estoque baixo: saldo até 3/); await view.click("Ruptura"); assert.match(view.container.textContent!, /Luva/);
    assert.ok(refresh); await act(async () => { refresh!(); await settle(); }); assert.equal(reads, 2);
    Object.defineProperty(browser.document, "visibilityState", { configurable: true, value: "hidden" }); refresh!(); assert.equal(reads, 2);
  } finally { await view.close(); browser.setInterval = nativeInterval; browser.clearInterval = nativeClear; Object.defineProperty(browser.document, "visibilityState", { configurable: true, value: "visible" }); }
});
it("paginação limita a exibição, mas busca encontra variantes de todo o catálogo", async () => {
  globalThis.fetch = async url => {
    if (url === "/api/auth/session") return Response.json({ ...session, configuracoesHabilitadas: false });
    assert.equal(url, "/api/inventory?page=1");
    return Response.json({ page: 1, nextPage: null, items: Array.from({ length: 61 }, (_, index) => ({ id: `${index + 100}:${index + 101}`, produtoId: String(index + 100), varianteId: String(index + 101), nome: `Produto ${index + 1}`, variante: "Azul", sku: `SKU-${index + 1}`, preco: 10, quantidade: 5, ruptura: false })) });
  };
  const view = await mount(<Inventory />);
  try {
    assert.match(view.container.textContent!, /Página 1 de 3/);
    assert.equal(view.container.querySelectorAll("article[data-product-id]").length, 30);
    assert.equal(view.container.querySelector('article[data-product-id="160"]'), null);
    await view.click("Próxima"); assert.match(view.container.textContent!, /Página 2 de 3/);
    const search = view.container.querySelector<HTMLInputElement>('input[type="search"]') ?? view.container.querySelector<HTMLInputElement>('input[placeholder]'); assert.ok(search);
    await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(search, "SKU-61"); search.dispatchEvent(new Event("input", { bubbles: true })); await settle(); });
    assert.match(view.container.textContent!, /Produto 61/); assert.match(view.container.textContent!, /Página 1 de 1/);
  } finally { await view.close(); }
});
