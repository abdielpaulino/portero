import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, before, it } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Browser, Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3000/login" });
const globals = { window, self: window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const requireTest = createRequire(__filename);
const css = requireTest.extensions[".css"];
const originalFetch = globalThis.fetch;
let Login: typeof import("../src/app/login/page").default;
let Context: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
let createRoot: typeof import("react-dom/client").createRoot;
const navigations: string[] = [];
const router = { bfcacheId: "login-test", back() {}, forward() {}, refresh() {}, push() {},
  replace(url: string) { navigations.push(url); }, prefetch() {} };
const view = () => <Context.Provider value={router}><Login /></Context.Provider>;

before(async () => {
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  requireTest.extensions[".css"] = module => { module.exports = {}; };
  createRoot = (await import("react-dom/client")).createRoot;
  Login = requireTest("../src/app/login/page").default;
  Context = requireTest("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (css) requireTest.extensions[".css"] = css; else delete requireTest.extensions[".css"];
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  await window.happyDOM.close();
});

it("HTML sem scripts bloqueia o botão e mantém POST sem credenciais na URL mesmo no fallback nativo", async () => {
  const html = renderToStaticMarkup(view());
  const received: { method: string; url: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/login") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    let body = ""; for await (const chunk of req) body += String(chunk);
    received.push({ method: req.method!, url: req.url!, body });
    res.statusCode = 400; res.end("JavaScript necessário");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = new Browser({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true } });
  try {
    const page = browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/login`);
    const document = page.mainFrame.window.document;
    const form = document.querySelector("form")!;
    assert.equal(form.method, "post"); assert.equal(new URL(form.action).pathname, "/api/auth/login");
    assert.equal(form.querySelector("button")!.disabled, true);
    document.querySelector("#email")!.setAttribute("value", "local@example.test");
    document.querySelector("#password")!.setAttribute("value", "senha-ficticia");
    form.querySelector("button")!.click();
    await page.waitUntilComplete(); assert.equal(received.length, 0);
    // Simula o fallback sem handler, inclusive se um script falhar após habilitar o botão.
    form.querySelector("button")!.disabled = false;
    form.requestSubmit();
    await page.waitUntilComplete();
    assert.equal(received.length, 1);
    assert.equal(received[0].method, "POST"); assert.equal(received[0].url, "/api/auth/login");
    assert.ok(received[0].body.includes("local@example.test") || received[0].body.includes("local%40example.test"));
    assert.ok(received[0].body.includes("senha-ficticia"));
    assert.equal(new URL(page.url).search, "");
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("login hidratado envia JSON por POST e falha de rede não provoca navegação GET", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  let fail = false;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (fail) throw new Error("offline");
    return Response.json({ requiresStoreSelection: false, usuario: { id: 1 }, loja: { id: 2 } });
  };
  try {
    await act(async () => { root.render(view()); });
    const form = container.querySelector("form")!;
    assert.equal(form.querySelector("button")!.disabled, false);
    for (const [name, value] of [["email", "local@example.test"], ["password", "senha-ficticia"]]) {
      const input = container.querySelector<HTMLInputElement>(`#${name}`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
      });
    }
    await act(async () => { assert.equal(form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event), false); });
    assert.equal(calls[0].url, "/api/auth/login"); assert.equal(calls[0].init.method, "POST");
    assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), "application/json");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(calls[0].init.body as string), { email: "local@example.test", password: "senha-ficticia" });
    assert.deepEqual(navigations, ["/inventory"]);
    fail = true;
    await act(async () => { assert.equal(form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event), false); });
    assert.equal(calls.length, 2); assert.equal(calls[1].init.method, "POST");
    assert.match(container.querySelector('[role="alert"]')!.textContent!, /conectar/);
    assert.equal(window.location.search, ""); assert.deepEqual(navigations, ["/inventory"]);
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});
