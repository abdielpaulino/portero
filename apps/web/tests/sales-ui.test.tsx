import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { PAYMENT_METHODS } from "../src/app/sales/form";
import type { ExternalSale, SaleDraft } from "../src/app/sales/data";
import { stockProgressKey } from "../src/app/sales/completion";

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
function mockSales(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, price = 10) {
  globalThis.fetch = async (url, init) => {
    if (url === "/api/auth/session") return Response.json({ ...session, baixasHabilitadas: false });
    if (url === "/api/inventory?page=1") return Response.json({ page: 1, nextPage: null, items: [{ ...item, preco: price }] });
    if (url === "/api/sales/external?page=1") return Response.json({ page: 1, hasMore: false, items: [] });
    return handler(String(url), init);
  };
}
type View = Awaited<ReturnType<typeof mount>>;
const storage = "portero:venda:10:1", requestKey = "11111111-1111-4111-8111-111111111111";
const draft = { canal: "WhatsApp", formaPagamento: "Pix", moeda: "BRL", vendidaEm: "2026-11-01T12:00:00Z", descontoVenda: "0.00",
  pagamento: { situacao: "pendente", valorRecebido: "0.00" }, itens: [{ produtoId: "100", varianteId: "101", quantidade: 1, precoUnitario: "10.00", desconto: "0.00" }] };
async function begin(view: View) {
  await view.click("Nova venda"); await view.fill("Produto e variante", item.id); await view.click("Adicionar item"); await view.click("Continuar");
  await view.fill("Data da venda", "2026-11-01T12:00");
}
async function paymentStep(view: View) { await view.click("Continuar"); await view.fill("Canal", "WhatsApp"); await view.fill("Forma de pagamento", "Pix"); }
async function confirm(view: View) { await view.click("Continuar"); await view.click("Confirmar venda"); }
async function resendSaved(view: View) { await view.click("Conferir venda"); await view.click("Enviar registro salvo"); }
function mockPending(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  mockSales((url, init) => url.includes("/by-request/") ? Response.json({ message: "Venda não encontrada." }, { status: 404 }) : handler(url, init));
}
it("inicia pelo histórico, usa quatro etapas e não confunde voltar com descartar", async () => {
  let posts = 0; mockSales(() => { posts++; return Response.json(sale); });
  const view = await mount(<Sales />);
  try {
    assert.equal(view.container.querySelector("form"), null); assert.match(view.container.textContent!, /Histórico/);
    await begin(view); assert.equal(view.container.querySelectorAll("ol li").length, 4);
    await view.click("Voltar às vendas"); assert.equal(posts, 0); await view.click("Nova venda"); await view.click("Continuar");
    assert.equal(view.container.querySelector<HTMLInputElement>('input[aria-label="Preço unitário (BRL)"]')!.value, "10,00");
    await view.click("Descartar preenchimento"); await view.click("Nova venda"); assert.match(view.container.textContent!, /Selecione um produto para começar/);
    assert.equal(posts, 0); assert.equal(browser.localStorage.getItem(storage), null);
  } finally { await view.close(); }
});
it("pagamento integral é padrão, acompanha alterações no total e usa a data da venda", async () => {
  let sent!: SaleDraft; mockSales((url, init) => { assert.equal(url, "/api/sales/external"); sent = JSON.parse(String(init?.body)); return Response.json(sale); }, 1250.25);
  const view = await mount(<Sales />);
  try {
    await begin(view); await view.fill("Quantidade", "2"); await view.fill("Desconto do item", "100,10");
    assert.ok(![...view.container.querySelectorAll("label")].some(label => label.textContent?.startsWith("Desconto adicional")));
    await view.click("Adicionar desconto"); await view.fill("Desconto adicional", "0,40");
    assert.match(view.container.querySelector('[aria-label="Totais da venda"]')!.textContent!, /Descontos aplicadosR\$ 100,50Total finalR\$ 2\.400,00/);
    await paymentStep(view);
    const method = [...view.container.querySelectorAll("label")].find(label => label.textContent?.startsWith("Forma de pagamento"))!.querySelector("select")!;
    assert.deepEqual([...method.options].map(option => option.value).filter(Boolean), PAYMENT_METHODS);
    assert.equal([...view.container.querySelectorAll("label")].find(label => label.textContent?.startsWith("Situação"))!.querySelector("select")!.value, "pago");
    assert.equal(view.container.querySelector('input[aria-label="Valor recebido (BRL)"]'), null); assert.match(view.container.textContent!, /Valor recebido: R\$ 2\.400,00/);
    await view.click("Voltar"); await view.fill("Quantidade", "1"); await view.click("Continuar"); assert.match(view.container.textContent!, /Valor recebido: R\$ 1\.149,75/);
    await view.fill("Data do recebimento", "2026-11-02T13:00"); await confirm(view);
    assert.equal(sent.pagamento.valorRecebido, "1149.75"); assert.equal(sent.pagamento.recebidoEm, new Date("2026-11-02T13:00").toISOString());
    assert.deepEqual(sent.itens, [{ produtoId: "100", varianteId: "101", quantidade: 1, precoUnitario: "1250.25", desconto: "100.10" }]);
    assert.equal("total" in sent, false); assert.equal(sent.descontoVenda, "0.40");
    assert.match(view.container.textContent!, /Venda registrada/); assert.match(view.container.textContent!, /A atualização do estoque precisa de atenção/);
  } finally { await view.close(); }
});
it("Pendente, Parcial e Pago enviam centavos exatos; total zero não cria recebimento", async () => {
  for (const [status, received, price] of [["pendente", "0.00", 10], ["parcial", "5.25", 10], ["pago", "10.00", 10], ["pendente", "0.00", 0], ["pago", "0.00", 0]] as const) {
    let sent!: SaleDraft; mockSales((url, init) => { assert.equal(url, "/api/sales/external"); sent = JSON.parse(String(init?.body)); return Response.json(sale); }, price);
    const view = await mount(<Sales />);
    try {
      await begin(view); await paymentStep(view); await view.fill("Situação do pagamento", status);
      if (status === "parcial") await view.fill("Valor recebido", "5,25");
      if (price === 0) assert.match(view.container.textContent!, /Total zero: pago, sem recebimento/);
      await confirm(view); assert.equal(sent.pagamento.valorRecebido, received); assert.equal(sent.pagamento.situacao, status);
      assert.equal("recebidoEm" in sent.pagamento, received !== "0.00");
      if (received !== "0.00") assert.equal(sent.pagamento.recebidoEm, new Date("2026-11-01T12:00").toISOString());
    } finally { await view.close(); }
  }
});
it("Parcial rejeita zero, total e excesso junto ao campo antes do envio", async () => {
  let posts = 0; mockSales(() => { posts++; return Response.json(sale); }); const view = await mount(<Sales />);
  try {
    await begin(view); await paymentStep(view); await view.fill("Situação", "parcial");
    for (const amount of ["0,00", "10,00", "10,01", "NaN"]) {
      await view.fill("Valor recebido", amount); await view.click("Continuar");
      assert.ok(view.container.querySelector('[role="alert"]')); assert.equal(view.container.querySelector('li[aria-current="step"]')!.textContent, "3Pagamento");
      assert.equal(posts, 0); assert.equal(browser.localStorage.getItem(storage), null);
    }
  } finally { await view.close(); }
});
it("valida preço, quantidade, desconto e data antes de continuar; não adivinha valores inválidos", async () => {
  let posts = 0; mockSales(() => { posts++; return Response.json(sale); }); const view = await mount(<Sales />);
  try {
    await begin(view);
    for (const amount of ["NaN", "1,234", "1,250.00", "-1,00"]) {
      await view.fill("Preço unitário", amount); await view.click("Continuar");
      assert.equal(view.container.querySelector('input[aria-label="Preço unitário (BRL)"]')!.getAttribute("aria-invalid"), "true");
    }
    await view.fill("Preço unitário", "10,00"); await view.fill("Quantidade", "0"); await view.click("Continuar"); assert.match(view.container.textContent!, /quantidade inteira positiva/);
    await view.fill("Quantidade", "1"); await view.click("Adicionar desconto"); await view.fill("Desconto adicional", "11,00"); await view.click("Continuar"); assert.match(view.container.textContent!, /desconto não pode superar/);
    assert.equal(posts, 0); assert.equal(browser.localStorage.getItem(storage), null);
  } finally { await view.close(); }
});
it("Outro registra complemento e USD/EUR preservam moeda e valores exatos", async () => {
  for (const currency of ["BRL", "USD", "EUR"]) {
    let sent!: SaleDraft; mockSales((url, init) => { assert.equal(url, "/api/sales/external"); sent = JSON.parse(String(init?.body)); return Response.json({ ...sale, moeda: currency }); });
    const view = await mount(<Sales />);
    try {
      await begin(view); await view.fill("Moeda", currency); await view.fill("Preço unitário", "2.000,15");
      await paymentStep(view); await view.fill("Forma de pagamento", "Outro"); await view.fill("Qual forma", "Vale-presente"); await confirm(view);
      assert.equal(sent.moeda, currency); assert.equal(sent.itens[0].precoUnitario, "2000.15"); assert.equal(sent.pagamento.valorRecebido, "2000.15"); assert.equal(sent.formaPagamento, "Outro: Vale-presente");
    } finally { await view.close(); }
  }
});
it("seleção mostra foto e tamanho corretos; imagem quebrada ou ausente usa alternativa visível", async () => {
  globalThis.fetch = async url => url === "/api/auth/session" ? Response.json(session) : String(url).includes("inventory")
    ? Response.json({ page: 1, nextPage: null, items: [{ ...item, imagemUrl: "/luva-9.jpg" }, { ...item, id: "100:102", varianteId: "102", variante: "10", sku: "LUVA-10", quantidade: 0, imagemUrl: "/luva-10.jpg" }, { ...item, id: "200:201", produtoId: "200", varianteId: "201" }] })
    : Response.json({ page: 1, hasMore: false, items: [] });
  const view = await mount(<Sales />);
  try {
    await view.click("Nova venda"); await view.fill("Produto e variante", "100:101"); assert.ok(view.container.querySelector('img[src="/luva-9.jpg"]'));
    await view.fill("Produto e variante", "100:102"); assert.match(view.container.textContent!, /Tamanho: 10LUVA-10Estoque: 0/);
    const img = view.container.querySelector('img[src="/luva-10.jpg"]')!; await act(() => img.dispatchEvent(new browser.Event("error") as unknown as Event));
    assert.ok(view.container.querySelector('[aria-label="Produto sem foto"]')); await view.click("Adicionar item");
    await view.fill("Produto e variante", "200:201"); assert.ok(view.container.querySelector('[aria-label="Produto sem foto"]')); await view.click("Adicionar item");
    assert.equal(view.container.querySelectorAll("article").length, 2);
  } finally { await view.close(); }
});
it("resposta perdida bloqueia nova venda e só recupera pelo mesmo identificador, sem executar estoque", async () => {
  const attempts: { key: string; body: string }[] = []; let found = false;
  mockSales((url, init) => {
    if (url.includes("/by-request/")) return found ? Response.json(sale) : Response.json({ message: "Não encontrada." }, { status: 404 });
    assert.equal(url, "/api/sales/external"); const saved = JSON.parse(browser.localStorage.getItem(storage)!);
    attempts.push({ key: new Headers(init?.headers).get("Idempotency-Key")!, body: String(init?.body) }); assert.equal(saved.key, attempts[0].key);
    if (attempts.length === 1) throw new Error("Resposta perdida"); return Response.json(sale);
  });
  let view = await mount(<Sales />);
  try {
    await begin(view); await paymentStep(view); await confirm(view); const saved = browser.localStorage.getItem(storage);
    assert.ok(saved); assert.match(view.container.textContent!, /Ainda não conseguimos confirmar esta venda/);
    assert.ok(![...view.container.querySelectorAll("button")].some(button => button.textContent === "Tentar novamente"));
    await view.submit(); assert.equal(attempts.length, 1); await view.close(); view = await mount(<Sales />);
    assert.ok([...view.container.querySelectorAll("button")].find(button => button.textContent === "Nova venda")!.disabled);
    await resendSaved(view); assert.deepEqual(attempts[0], attempts[1]); assert.equal(browser.localStorage.getItem(`${storage}:id`), "1"); assert.equal(browser.localStorage.getItem(storage), null);
    // A recuperação encontrada usa somente GET, inclusive após uma nova montagem.
    await view.close(); browser.localStorage.setItem(storage, saved!); found = true; view = await mount(<Sales />); await view.click("Conferir venda"); assert.equal(attempts.length, 2);
    assert.match(view.container.textContent!, /Registro recuperado/);
  } finally { await view.close(); }
});
it("solicitação recusada permite correção com mesma chave, valores salvos e retomada após recarga", async () => {
  const original = { ...draft, pagamento: { situacao: "pago", valorRecebido: "0.00" } }; browser.localStorage.setItem(storage, JSON.stringify({ key: requestKey, body: original }));
  const attempts: { key: string; body: SaleDraft }[] = [];
  mockPending((url, init) => {
    assert.equal(url, "/api/sales/external"); attempts.push({ key: new Headers(init?.headers).get("Idempotency-Key")!, body: JSON.parse(String(init?.body)) });
    if (attempts.length === 1) return Response.json({ message: "Situação do pagamento incompatível com o valor recebido e o total." }, { status: 400 });
    if (attempts.length === 2) throw new Error("Resposta perdida"); return Response.json(sale);
  });
  let view = await mount(<Sales />);
  try {
    await resendSaved(view); assert.deepEqual(attempts[0].body, original); await view.click("Corrigir dados da venda");
    assert.deepEqual(JSON.parse(browser.localStorage.getItem(storage)!).body, original); assert.equal(JSON.parse(browser.localStorage.getItem(storage)!).correcting, true);
    await view.close(); view = await mount(<Sales />); await view.click("Retomar correção");
    assert.equal(view.container.querySelector<HTMLInputElement>('input[aria-label="Preço unitário (BRL)"]')!.value, "10,00");
    await view.click("Continuar"); await view.click("Continuar"); await view.click("Confirmar correção"); assert.equal(attempts.length, 2);
    assert.equal(attempts[1].body.pagamento.valorRecebido, "10.00"); assert.equal(JSON.parse(browser.localStorage.getItem(storage)!).correcting, undefined);
    await view.close(); view = await mount(<Sales />); await resendSaved(view);
    assert.deepEqual(attempts.map(attempt => attempt.key), [requestKey, requestKey, requestKey]); assert.deepEqual(attempts[1].body, attempts[2].body); assert.equal(browser.localStorage.getItem(storage), null);
  } finally { await view.close(); }
});
it("conflito mantém recuperação da venda existente e nunca cria outra nem envia estoque", async () => {
  browser.localStorage.setItem(storage, JSON.stringify({ key: requestKey, body: draft })); let posts = 0, found = false;
  mockSales((url, init) => {
    if (url.includes("/by-request/")) return found ? Response.json(sale) : Response.json({}, { status: 404 });
    assert.equal(url, "/api/sales/external"); assert.equal(new Headers(init?.headers).get("Idempotency-Key"), requestKey); posts++;
    return Response.json({ message: posts === 1 ? "Solicitação inválida." : "A chave já pertence a uma venda com outros dados." }, { status: posts === 1 ? 400 : 409 });
  });
  const view = await mount(<Sales />);
  try {
    await resendSaved(view); await view.click("Corrigir dados da venda"); await view.click("Continuar"); await view.fill("Canal", "Presencial"); await view.click("Continuar"); await view.click("Confirmar correção");
    assert.equal(posts, 2); assert.equal(JSON.parse(browser.localStorage.getItem(storage)!).key, requestKey);
    found = true; await view.click("Conferir venda"); assert.equal(posts, 2); assert.equal(browser.localStorage.getItem(`${storage}:id`), "1");
  } finally { await view.close(); }
});
it("correção bloqueia se outra aba remover ou substituir a solicitação; recuperação mantém a identidade original", async () => {
  for (const replacement of [null, "22222222-2222-4222-8222-222222222222"]) {
    browser.localStorage.setItem(storage, JSON.stringify({ key: requestKey, body: draft })); let posts = 0, found = false;
    mockSales((url, init) => {
      if (url.includes("/by-request/")) { assert.ok(url.endsWith(requestKey)); return found ? Response.json(sale) : Response.json({}, { status: 404 }); }
      assert.equal(url, "/api/sales/external"); assert.equal(init?.method, "POST"); posts++; return Response.json({ message: "Solicitação inválida." }, { status: 400 });
    });
    const view = await mount(<Sales />);
    try {
      await resendSaved(view); await view.click("Corrigir dados da venda"); await view.click("Continuar"); await view.click("Continuar");
      await act(() => { if (replacement) browser.localStorage.setItem(storage, JSON.stringify({ key: replacement, body: draft })); else browser.localStorage.removeItem(storage); window.dispatchEvent(new browser.Event("portero:sales-request") as unknown as Event); });
      await view.submit(); assert.equal(posts, 1); found = true; await view.click("Conferir venda"); assert.equal(posts, 1);
      assert.equal(replacement ? JSON.parse(browser.localStorage.getItem(storage)!).key : browser.localStorage.getItem(storage), replacement);
    } finally { await view.close(); browser.localStorage.clear(); }
  }
});
it("resposta de uma venda não remove o registro seguinte de outra aba", async () => {
  let finish!: (response: Response) => void; mockSales(() => new Promise<Response>(resolve => { finish = resolve; })); const view = await mount(<Sales />);
  try {
    await begin(view); await paymentStep(view); await confirm(view); assert.ok(finish);
    const original = JSON.parse(browser.localStorage.getItem(storage)!), following = JSON.stringify({ key: "22222222-2222-4222-8222-222222222222", body: { ...original.body, canal: "Presencial" } });
    await act(() => { browser.localStorage.setItem(storage, following); window.dispatchEvent(new browser.Event("portero:sales-request") as unknown as Event); });
    await act(() => finish(Response.json(sale))); assert.equal(browser.localStorage.getItem(storage), following); assert.equal(browser.localStorage.getItem(`${storage}:id`), "1");
  } finally { await view.close(); }
});
it("consulta não encontrada não autoriza enviar outra solicitação trocada por outra aba", async () => {
  browser.localStorage.setItem(storage, JSON.stringify({ key: requestKey, body: draft })); let posts = 0;
  mockSales((url, init) => { if (init?.method === "POST") posts++; assert.ok(url.endsWith(requestKey)); return Response.json({}, { status: 404 }); });
  const view = await mount(<Sales />);
  try {
    await view.click("Conferir venda");
    const replacement = JSON.stringify({ key: "22222222-2222-4222-8222-222222222222", body: { ...draft, canal: "Presencial" } });
    await act(() => { browser.localStorage.setItem(storage, replacement); window.dispatchEvent(new browser.Event("portero:sales-request") as unknown as Event); });
    await view.click("Enviar registro salvo"); assert.equal(posts, 0); assert.equal(browser.localStorage.getItem(storage), replacement);
    assert.match(view.container.textContent!, /solicitação salva mudou/);
  } finally { await view.close(); }
});
it("cancelamento exige confirmação e navegar de volta não cancela nem repõe estoque", async () => {
  let cancellations = 0; mockSales((url, init) => {
    if (url === "/api/sales/external") return Response.json(sale);
    assert.equal(url, "/api/sales/external/1/cancel"); assert.equal(init?.method, "POST"); cancellations++; return Response.json({ ...sale, situacao: "cancelada" });
  }); const view = await mount(<Sales />);
  try {
    await begin(view); await paymentStep(view); await confirm(view); await view.click("Cancelar venda"); assert.equal(cancellations, 0);
    assert.match(view.container.textContent!, /estoque não será reposto/); await view.click("Manter venda"); assert.equal(cancellations, 0);
    await view.click("Cancelar venda"); await view.click("Confirmar cancelamento"); assert.equal(cancellations, 1);
    await view.click("Ver vendas"); assert.equal(cancellations, 1);
  } finally { await view.close(); }
});
it("movimento financeiro preserva chave/corpo após perda da resposta e não solicita estoque", async () => {
  const attempts: string[] = []; let fail = true;
  globalThis.fetch = async (url, init) => { assert.equal(url, "/api/sales/external/1/financial-events"); attempts.push(String(init?.body) + new Headers(init?.headers).get("Idempotency-Key")); if (fail) throw new Error("Resposta perdida"); return Response.json(sale); };
  const view = await mount(<Financial sale={sale} session={session} onChange={() => {}} />);
  try { await view.fill("Valor", "5,25"); await view.fill("Data", "2026-11-01T12:00"); await view.submit(); fail = false; await view.submit(); assert.equal(attempts[0], attempts[1]); assert.match(view.container.textContent!, /Movimento registrado/); }
  finally { await view.close(); }
});
it("movimento financeiro valida zero e corrige solicitação recusada sem criar outra chave", async () => {
  const key = "portero:financeiro:10:1:1"; const attempts: { key: string; body: { valor: string } }[] = [];
  globalThis.fetch = async (url, init) => { assert.equal(url, "/api/sales/external/1/financial-events"); attempts.push({ key: new Headers(init?.headers).get("Idempotency-Key")!, body: JSON.parse(String(init?.body)) }); return attempts.length === 1 ? Response.json({ message: "Valor inválido." }, { status: 400 }) : Response.json(sale); };
  const view = await mount(<Financial sale={sale} session={session} onChange={() => {}} />);
  try {
    await view.fill("Valor", "0,00"); await view.fill("Data", "2026-11-01T12:00"); await view.submit(); assert.equal(attempts.length, 0);
    await view.fill("Valor", "1.250,99"); await view.submit(); await view.click("Corrigir dados do movimento"); await view.fill("Valor", "1,00"); await view.submit();
    assert.equal(attempts[0].body.valor, "1250.99"); assert.equal(attempts[1].body.valor, "1.00"); assert.equal(attempts[0].key, attempts[1].key); assert.equal(browser.localStorage.getItem(key), null);
  } finally { await view.close(); }
});
it("dashboard distingue origens, moedas e recebido líquido, mantendo alertas fora dos detalhes", async () => {
  globalThis.fetch = async url => {
    if (url === "/api/auth/session") return Response.json(session); const period = new URL(`http://localhost${url}`).searchParams.get("periodo");
    if (String(url).includes("external/summary")) return Response.json({ periodo: period, fuso: "America/Sao_Paulo", totais: [{ canal: "WhatsApp", moeda: "BRL", vendas: 1, valorVendido: "10.00", recebimentos: "5.00", estornos: "1.00", recebidoLiquido: "4.00", pagamentosPendentes: 1 }], estoque: { pendentes: 1, incertas: 1 }, diario: [{ dia: `${period}-01`, moeda: "BRL", valor: "10.00" }] });
    return Response.json({ periodo: period, page: 1, hasMore: true, items: [{ id: "1", storeId: "123", numero: "7", origem: "nuvemshop", canal: "loja_online", criadoEm: `${period}-01T12:00:00Z`, status: "open", pagamento: "pending", moeda: "USD", valorProdutos: "20.00", totalPedido: "25.00" }] });
  }; const view = await mount(<Dashboard />);
  try {
    assert.match(view.container.textContent!, /Recebido nas vendas externasR\$ 4,00/); assert.match(view.container.textContent!, /A receber nas vendas externasIndisponível/);
    assert.doesNotMatch(view.container.textContent!, /item\(ns\)|pedido\(s\)|read_orders|partially_paid/);
    const partial = [...view.container.querySelectorAll('[role="alert"]')].find(el => el.textContent!.includes("Dados incompletos"))!; assert.ok(partial); assert.equal(partial.closest("details"), null);
    const chart = view.container.querySelector('[aria-label="Valor comercial diário"]')!; assert.equal(chart.closest("details"), null); assert.equal(chart.querySelectorAll("svg").length, 1);
    assert.match(chart.textContent!, /Não representa valor recebido/); assert.doesNotMatch(chart.textContent!, /25,00/);
    await view.fill("Moeda", "USD"); assert.match(view.container.querySelector('[aria-label="Principais indicadores"]')!.textContent!, /Valor vendidoUSD 20,00/);
  } finally { await view.close(); }
});
it("dashboard traduz falta de permissão sem exibir scopes ou detalhes técnicos", async () => {
  globalThis.fetch = async url => url === "/api/auth/session" ? Response.json({ ...session, vendasExternasHabilitadas: false }) : Response.json({ message: "Configure read_orders na API (HTTP 403)." }, { status: 403 });
  const view = await mount(<Dashboard />); try { assert.match(view.container.textContent!, /Pedidos online ainda não disponíveis/); assert.doesNotMatch(view.container.textContent!, /read_orders|HTTP|\bAPI\b/); } finally { await view.close(); }
});
it("flags desativadas não consultam tabelas comerciais nem impedem navegação", async () => {
  const calls: string[] = []; globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ usuarioId: 1, loja: session.loja }); };
  const view = await mount(<Sales />); try { assert.deepEqual(calls, ["/api/auth/session"]); assert.match(view.container.textContent!, /ainda não ativadas/); assert.equal(view.container.querySelector("form"), null); await view.click("Conferir disponibilidade"); assert.equal(calls.length, 2); } finally { await view.close(); }
  calls.length = 0; const dashboard = await mount(<Dashboard />); try { assert.deepEqual(calls, ["/api/auth/session"]); assert.equal(dashboard.container.textContent, ""); } finally { await dashboard.close(); }
});
it("sessão carregando não é anunciada como recurso desativado", async () => {
  let finish!: (response: Response) => void; globalThis.fetch = async () => new Promise<Response>(resolve => { finish = resolve; }); const view = await mount(<Sales />);
  try { assert.match(view.container.textContent!, /Carregando vendas/); assert.doesNotMatch(view.container.textContent!, /não ativadas/); await act(() => finish(Response.json({ ...session, vendasExternasHabilitadas: false }))); assert.match(view.container.textContent!, /não ativadas/); } finally { await view.close(); }
});
it("falha de leitura permite carregar novamente, mas não libera formulário sem catálogo e histórico", async () => {
  let fail = true; const calls: string[] = [];
  globalThis.fetch = async (url, init) => { assert.equal(init?.method ?? "GET", "GET"); calls.push(String(url)); if (fail) throw new Error("API indisponível"); if (url === "/api/auth/session") return Response.json(session); if (String(url).includes("inventory")) return Response.json({ page: 1, nextPage: null, items: [item] }); return Response.json({ page: 1, hasMore: false, items: [] }); };
  const view = await mount(<Sales />); try { assert.match(view.container.textContent!, /Não foi possível abrir/); assert.equal(view.container.querySelector("form"), null); fail = false; await view.click("Carregar novamente"); await view.click("Nova venda"); assert.ok(view.container.querySelector("form")); assert.equal(calls.filter(url => url === "/api/auth/session").length, 2); } finally { await view.close(); }
});
it("histórico indisponível bloqueia uma venda incompleta e conserva aviso visível", async () => {
  globalThis.fetch = async url => url === "/api/auth/session" ? Response.json(session) : String(url).includes("inventory") ? Response.json({ page: 1, nextPage: null, items: [item] }) : Response.json({ message: "Histórico indisponível." }, { status: 503 });
  const view = await mount(<Sales />); try { assert.match(view.container.textContent!, /Histórico indisponível/); assert.equal(view.container.querySelector("form"), null); assert.ok(view.container.querySelector('[role="alert"]')); } finally { await view.close(); }
});

function operationalMock(options: { count?: number; fail?: number; lost?: number; pause?: number; enabled?: boolean; existing?: boolean } = {}) {
  const count = options.count ?? 1;
  const catalog = Array.from({ length: count }, (_, index) => ({ ...item, id: `${100 + index}:${101 + index}`, produtoId: String(100 + index), varianteId: String(101 + index), variante: String(9 + index), sku: `LUVA-${index}`, imagemUrl: `/luva-${index}.jpg` }));
  let current: ExternalSale = { ...sale, situacaoPagamento: "pago", total: `${count * 10}.00`, subtotal: `${count * 10}.00`, valorRecebido: `${count * 10}.00`,
    itens: catalog.map((row, index) => ({ ...sale.itens[0], id: 100 + index, produtoId: row.produtoId, varianteId: row.varianteId, nomeVariante: row.variante, sku: row.sku })), movimentos: [] };
  const requests: { url: string; method: string }[] = [], executions: number[] = [];
  let release: (() => void) | undefined;
  let exists = options.existing === true;
  globalThis.fetch = async (url, init) => {
    const path = String(url), method = init?.method ?? "GET"; requests.push({ url: path, method });
    if (path === "/api/auth/session") return Response.json({ ...session, baixasHabilitadas: options.enabled !== false });
    if (path === "/api/inventory?page=1") return Response.json({ page: 1, nextPage: null, items: catalog });
    if (path === "/api/sales/external?page=1") return Response.json({ page: 1, hasMore: false, items: exists ? [current] : [] });
    if (path === "/api/sales/external/1" && method === "GET") return Response.json(current);
    if (path.includes("/by-request/")) return Response.json(current);
    if (path === "/api/sales/external" && method === "POST") {
      current = { ...current, requisicaoId: new Headers(init?.headers).get("Idempotency-Key")! }; exists = true;
      return Response.json(current);
    }
    const match = /^\/api\/sales\/external\/1\/items\/(\d+)\/execute$/.exec(path);
    if (match && method === "POST") {
      const id = Number(match[1]); executions.push(id);
      assert.equal(browser.localStorage.getItem(`${storage}:id`), "1", "a venda deve estar guardada antes da primeira execução");
      const progress = JSON.parse(browser.localStorage.getItem(stockProgressKey(storage, 1))!);
      assert.equal(progress.vendaId, 1); assert.equal(progress.emEnvio, id); assert.deepEqual(progress.itens.map((row: { id: number }) => row.id), current.itens.map(row => row.id));
      assert.equal(String(init?.body), "{}");
      const previous = current.itens.find(row => row.id === id)!;
      assert.equal(previous.estoque, "nao_solicitada", "nenhuma baixa concluída deve ser enviada novamente");
      if (id === options.pause) await new Promise<void>(resolve => { release = resolve; });
      const state = id === options.fail ? "incerta" : "sincronizada";
      current = { ...current, itens: current.itens.map(row => row.id === id ? { ...row, baixaId: id + 1000, estoque: state } : row) };
      const all = current.itens.every(row => row.estoque === "sincronizada");
      current = { ...current, estoque: all ? "sincronizada" : current.itens.some(row => row.estoque === "sincronizada") ? "parcial" : "pendente", exigeConferencia: current.itens.some(row => row.estoque === "incerta") };
      if (id === options.lost) throw new Error("Resposta perdida após atualização");
      return Response.json({ venda: current, itemId: id, baixa: { baixaId: id + 1000, statusSincronizacao: state } }, { status: state === "incerta" ? 502 : all ? 200 : 207 });
    }
    throw new Error(`Rota não esperada: ${method} ${path}`);
  };
  return { catalog, requests, executions, release: () => { assert.ok(release); release(); }, get current() { return current; } };
}
async function prepareOperational(view: View, catalog: typeof item[]) {
  await view.click("Nova venda");
  for (const row of catalog) { await view.fill("Produto e variante", row.id); await view.click("Adicionar item"); }
  await view.click("Continuar"); await paymentStep(view); await view.click("Continuar");
}
for (const count of [1, 3]) it(`uma confirmação registra venda com ${count} item(ns), guarda IDs e conclui estoque em sequência`, async () => {
  const mock = operationalMock({ count }); const view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); await view.click("Confirmar venda");
    assert.equal(mock.requests.filter(row => row.url === "/api/sales/external" && row.method === "POST").length, 1);
    assert.deepEqual(mock.executions, mock.catalog.map((_, index) => 100 + index));
    assert.match(view.container.querySelector("h2")!.textContent!, /^Venda concluída$/);
    assert.equal([...view.container.querySelectorAll("button")].filter(button => button.textContent === "Nova venda").length, 1);
    assert.equal([...view.container.querySelectorAll("button")].filter(button => button.textContent === "Ver vendas").length, 1);
    assert.ok(![...view.container.querySelectorAll("button")].some(button => /Atualizar venda|Atualizar estoque deste item/.test(button.textContent!)));
    const result = view.container.querySelector('section[aria-busy]')!;
    assert.equal([...result.querySelectorAll("article img")].length, count);
    assert.ok([...result.querySelectorAll("article")].every(row => !row.textContent!.includes("Estoque:")));
    const details = [...view.container.querySelectorAll("details")].find(row => row.querySelector("summary")?.textContent === "Ver detalhes")!;
    assert.equal(details.open, false); assert.ok(details.querySelector("form"));
    assert.equal(browser.localStorage.getItem(storage), null);
    assert.ok(mock.requests.filter(row => row.url.includes("inventory?page")).length >= 2, "o catálogo é consultado após as baixas");
  } finally { await view.close(); }
});
it("falha parcial interrompe a sequência e a conferência não repete baixas concluídas", async () => {
  const mock = operationalMock({ count: 3, fail: 101 }); let view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); await view.click("Confirmar venda"); assert.deepEqual(mock.executions, [100, 101]);
    assert.doesNotMatch(view.container.textContent!, /Venda concluída/); assert.match(view.container.textContent!, /Venda registrada\. A atualização do estoque precisa de atenção\./);
    const attention = [...view.container.querySelectorAll('[role="alert"]')].find(row => row.textContent!.includes("precisa de atenção"))!;
    assert.equal(attention.querySelectorAll("a,button").length, 1); assert.equal(attention.querySelector("a")!.textContent, "Conferir baixas");
    assert.equal(mock.current.itens[0].estoque, "sincronizada"); assert.equal(mock.current.itens[2].estoque, "nao_solicitada");
    await view.click("Ver vendas"); await view.click("Ver venda"); assert.deepEqual(mock.executions, [100, 101]);
    await view.close(); view = await mount(<Sales />); await view.click("Ver venda"); assert.deepEqual(mock.executions, [100, 101]);
  } finally { await view.close(); }
});
it("resposta do estoque perdida preserva a execução e só GET pode revelar a conclusão", async () => {
  const mock = operationalMock({ lost: 100 }); let view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); await view.click("Confirmar venda");
    assert.deepEqual(mock.executions, [100]); assert.doesNotMatch(view.container.textContent!, /Venda concluída/);
    assert.equal(JSON.parse(browser.localStorage.getItem(stockProgressKey(storage, 1))!).emEnvio, 100);
    await view.close(); view = await mount(<Sales />); assert.deepEqual(mock.executions, [100]);
    await view.click("Ver venda"); assert.match(view.container.querySelector("h2")!.textContent!, /^Venda concluída$/); assert.deepEqual(mock.executions, [100]);
    assert.equal(browser.localStorage.getItem(stockProgressKey(storage, 1)), null);
  } finally { await view.close(); }
});
it("perda de resposta no segundo item não reenvia o primeiro; continuar exige ação explícita", async () => {
  const mock = operationalMock({ count: 3, lost: 101 }); const view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); await view.click("Confirmar venda"); assert.deepEqual(mock.executions, [100, 101]);
    await view.click("Conferir atualização"); assert.deepEqual(mock.executions, [100, 101]); assert.doesNotMatch(view.container.textContent!, /Venda concluída/);
    await view.click("Concluir atualização do estoque"); assert.deepEqual(mock.executions, [100, 101, 102]); assert.match(view.container.querySelector("h2")!.textContent!, /^Venda concluída$/);
  } finally { await view.close(); }
});
it("cliques repetidos durante a baixa não recriam a venda nem repetem a execução", async () => {
  const mock = operationalMock({ count: 2, pause: 100 }); const view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); await view.click("Confirmar venda"); assert.deepEqual(mock.executions, [100]);
    assert.match(view.container.textContent!, /Concluindo venda/); assert.doesNotMatch(view.container.textContent!, /Venda concluída/);
    await view.click("Nova venda"); await view.click("Ver vendas");
    assert.equal(view.container.querySelector('section[aria-busy="true"]') !== null, true);
    assert.equal(mock.requests.filter(row => row.url === "/api/sales/external" && row.method === "POST").length, 1); assert.deepEqual(mock.executions, [100]);
    await act(async () => { mock.release(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.deepEqual(mock.executions, [100, 101]); assert.match(view.container.querySelector("h2")!.textContent!, /^Venda concluída$/);
  } finally { await view.close(); }
});
it("reabrir uma venda ainda não executada apenas consulta; nenhuma execução parte da montagem", async () => {
  const mock = operationalMock({ count: 2, existing: true }); const view = await mount(<Sales />);
  try {
    await view.click("Ver venda"); assert.deepEqual(mock.executions, []); assert.equal(mock.requests.filter(row => row.method === "POST").length, 0);
    await view.click("Concluir atualização do estoque"); assert.deepEqual(mock.executions, [100, 101]);
  } finally { await view.close(); }
});
it("saída durante a execução não inicia os próximos itens e a reabertura não os dispara", async () => {
  const mock = operationalMock({ count: 2, pause: 100 }); let view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); await view.click("Confirmar venda"); await view.close();
    await act(async () => { mock.release(); await new Promise(resolve => setTimeout(resolve, 20)); }); assert.deepEqual(mock.executions, [100]);
    view = await mount(<Sales />); await view.click("Ver venda"); assert.deepEqual(mock.executions, [100]);
  } finally { await view.close(); }
});
it("estoque desabilitado é informado antes da confirmação e nunca aparece como conclusão completa", async () => {
  const mock = operationalMock({ enabled: false }); const view = await mount(<Sales />);
  try {
    await prepareOperational(view, mock.catalog); assert.match(view.container.textContent!, /A atualização do estoque está desabilitada\. Esta confirmação registrará somente a venda/);
    await view.click("Confirmar venda"); assert.deepEqual(mock.executions, []); assert.doesNotMatch(view.container.textContent!, /Venda concluída/);
    assert.match(view.container.textContent!, /A atualização do estoque precisa de atenção/);
    await view.click("Conferir atualização"); assert.deepEqual(mock.executions, []);
  } finally { await view.close(); }
});
