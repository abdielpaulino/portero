"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import { carregarSessao, type Session } from "../auth/session";
import { carregarCatalogo, type Item } from "../inventory/data";
import { CommercialError, fetchSale, formatMoney, listSales, type ExternalSale, type SaleDraft } from "./data";
import { awaitingStockResponse, completeSaleStock, hasReadyItems, inspectSaleStock, requiresStockReview, saleCompleted, stockProgressKey } from "./completion";
import { clearSavedRequest, correctionKey, readSavedRequest, savePending, usePending } from "./pending";
import FinancialForm from "./FinancialForm";
import MoneyField from "./MoneyField";
import ProductPreview from "./ProductPreview";
import { countLabel, paymentLabel, userMessage } from "../components/presentation";
import { localDateInput, PAYMENT_METHODS, splitPaymentMethod, validateSaleForm } from "./form";
import { catalogMoney, formatMoneyInput } from "./money";
import styles from "../inventory/inventory.module.css";

type Line = { item: Item; quantidade: string; preco: string; desconto: string };
const stockLabels: Record<string, string> = { nao_solicitada: "Não solicitada", registrada: "Aguardando envio", pendente: "Pendente", parcial: "Parcial",
  sincronizada: "Confirmada", em_processamento: "Em processamento", incerta: "Sem confirmação", rejeitada: "Recusada", conferida_parcial: "Parcial conferida" };
export default function SalesPage() {
  const [session, setSession] = useState<Session | null>(null), [catalog, setCatalog] = useState<Item[]>([]);
  const [sales, setSales] = useState<ExternalSale[]>([]), [selected, setSelected] = useState<ExternalSale | null>(null);
  const [lines, setLines] = useState<Line[]>([]), [variant, setVariant] = useState("");
  const [channel, setChannel] = useState(""), [method, setMethod] = useState(""), [currency, setCurrency] = useState("BRL");
  const [date, setDate] = useState(""), [discount, setDiscount] = useState("0,00"), [payment, setPayment] = useState("pago");
  const [view, setView] = useState<"list" | "form" | "detail">("list"), [step, setStep] = useState(0);
  const [otherMethod, setOtherMethod] = useState(""), [showDiscount, setShowDiscount] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [finishing, setFinishing] = useState(false), [stockNeedsCheck, setStockNeedsCheck] = useState<number | null>(null);
  const [received, setReceived] = useState("0,00"), [receivedDate, setReceivedDate] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [page, setPage] = useState(1), [more, setMore] = useState(false), [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [loadRevision, setLoadRevision] = useState(0);
  const [attempted, setAttempted] = useState(false), [paymentTouched, setPaymentTouched] = useState(false), [activeKey, setActiveKey] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const generation = lifecycle.current;
    return () => { mounted.current = false; lifecycle.current = generation + 1; };
  }, []);
  const stepTitle = useRef<HTMLLegendElement>(null);
  useEffect(() => { if (view === "form") stepTitle.current?.focus(); }, [view, step]);
  const storageKey = session ? `portero:venda:${session.loja.id}:${session.usuarioId}` : null;
  const pending = usePending(storageKey);
  const progressKey = selected && storageKey ? stockProgressKey(storageKey, selected.id) : null;
  const stockProgress = usePending(progressKey);
  const financialPending = usePending(selected && storageKey && session ? `portero:financeiro:${session.loja.id}:${session.usuarioId}:${selected.id}` : null);
  const needsStockInspection = !!selected && (stockNeedsCheck === selected.id || awaitingStockResponse(stockProgress));
  const completed = !!selected && !needsStockInspection && saleCompleted(selected);
  const correction = correctionKey(pending), editing = correction !== null && correction === activeKey;
  const frozen = (!!pending && !editing) || (!pending && !!activeKey);
  const form = { canal: channel, formaPagamento: method === "Outro" && otherMethod.trim() ? `Outro: ${otherMethod.trim()}` : method,
    moeda: currency, vendidaEm: date, descontoVenda: discount, situacao: payment, valorRecebido: received, recebidoEm: receivedDate || date,
    itens: lines.map(line => ({ produtoId: line.item.produtoId, varianteId: line.item.varianteId, quantidade: line.quantidade, preco: line.preco, desconto: line.desconto })) };
  const preview = validateSaleForm({ ...form, situacao: "pendente", valorRecebido: "0,00" });
  const effectiveReceived = payment === "pago" ? formatMoneyInput(preview.total ?? "0.00") : payment === "pendente" ? "0,00" : received;
  const validation = validateSaleForm({ ...form, valorRecebido: effectiveReceived });
  const errors: Record<string, string> = attempted ? validation.errors : {};
  const paymentError = attempted || paymentTouched ? validation.errors.situacao : undefined;
  function fieldError(name: string) { return errors[name] ? <small className={styles.fieldError} id={`sale-${name}`} role="alert">{errors[name]}</small> : null; }
  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then(async value => {
      if (controller.signal.aborted) return; setSession(value);
      if (!value) throw new Error("Sessão indisponível. Entre novamente para consultar vendas externas.");
      if (!value.vendasExternasHabilitadas) { setReady(true); return; }
      const [items, history] = await Promise.all([carregarCatalogo(controller.signal), listSales(1, controller.signal)]);
      if (!controller.signal.aborted) { setCatalog(items); setSales(history.items); setMore(history.hasMore); setReady(true); }
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar as vendas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadRevision]);
  function update(sale: ExternalSale) { setSelected(sale); setView("detail"); setConfirmCancel(false); setSales(current => [sale, ...current.filter(item => item.id !== sale.id)]); }
  function startNew() {
    if (pending || activeKey || busy) return;
    if (selected) {
      setLines([]); setVariant(""); setChannel(""); setMethod(""); setOtherMethod(""); setCurrency("BRL");
      setDiscount("0,00"); setShowDiscount(false); setPayment("pago"); setReceived("0,00"); setReceivedDate("");
      setDate(localDateInput(new Date().toISOString())); setAttempted(false); setPaymentTouched(false);
    }
    setSelected(null); setView("form"); setStep(0); setMessage(""); setError(""); setConfirmCancel(false);
    if (!date) setDate(localDateInput(new Date().toISOString()));
  }
  function discard() {
    if (pending || activeKey || busy) return;
    setLines([]); setVariant(""); setChannel(""); setMethod(""); setOtherMethod(""); setCurrency("BRL"); setDate("");
    setDiscount("0,00"); setShowDiscount(false); setPayment("pago"); setReceived("0,00"); setReceivedDate("");
    setAttempted(false); setPaymentTouched(false); setView("list"); setError(""); setMessage("");
  }
  function advance() {
    setAttempted(true);
    const relevant = Object.keys(validation.errors).filter(key => step === 0 ? key === "itens" : step === 1 ? key.startsWith("itens.") || ["itens", "descontoVenda", "moeda", "vendidaEm"].includes(key) : true);
    if (relevant.length) return;
    setAttempted(false); setStep(current => Math.min(3, current + 1));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!session || !storageKey || submitting.current) return;
    if ((!pending || editing) && step < 3) { advance(); return; }
    if (pending && !editing && !canResend) return;
    const generation = lifecycle.current;
    submitting.current = true; setBusy(true); setError(""); setMessage(""); setInvalid(false);
    try {
      const saved = window.localStorage.getItem(storageKey);
      let request = saved ? readSavedRequest<SaleDraft>(saved) : null;
      if (activeKey && request?.key !== activeKey) throw new Error("A solicitação salva mudou. Recupere o registro antes de continuar.");
      if (!request || request.correcting) {
        if (request?.correcting && activeKey !== request.key) throw new Error("Retome a correção da solicitação salva.");
        setAttempted(true);
        if (!validation.body) return;
        request = { key: request?.key ?? crypto.randomUUID(), body: validation.body };
        savePending(storageKey, JSON.stringify(request));
      }
      setActiveKey(request.key);
      const sale = await fetchSale("", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
      window.localStorage.setItem(`${storageKey}:id`, String(sale.id)); update(sale); clearSavedRequest(storageKey, request.key); setActiveKey(null); setLines([]);
      setAttempted(false); setPaymentTouched(false); setDate(""); setReceivedDate(""); setDiscount("0,00"); setShowDiscount(false);
      setPayment("pago"); setReceived("0,00"); setChannel(""); setMethod(""); setOtherMethod(""); setVariant(""); setCurrency("BRL"); setCanResend(false);
      await finishStock(sale, generation);
    } catch (failure) { setInvalid(failure instanceof CommercialError && failure.status === 400); setCanResend(false);
      setError(userMessage(failure, "Ainda não conseguimos confirmar esta venda. Confira o registro antes de tentar novamente.")); }
    finally { submitting.current = false; setBusy(false); }
  }
  function correctRequest() {
    if (!pending || !storageKey || busy || (!invalid && !correction)) return;
    try {
      const request = readSavedRequest<SaleDraft>(pending), body = request.body;
      if (activeKey && request.key !== activeKey) throw new Error("A solicitação salva mudou. Recupere o registro antes de continuar.");
      if (!Array.isArray(body.itens) || !body.pagamento || !["BRL", "USD", "EUR"].includes(body.moeda)) throw new Error("Solicitação salva inválida. Consulte o histórico.");
      const restored = body.itens.map(line => {
        const item = catalog.find(item => item.produtoId === line.produtoId && item.varianteId === line.varianteId);
        if (!item) throw new Error("Há variantes fora do catálogo. Consulte o histórico antes de corrigir.");
        return { item, quantidade: String(line.quantidade), preco: formatMoneyInput(String(line.precoUnitario ?? "")), desconto: formatMoneyInput(String(line.desconto ?? "")) };
      });
      savePending(storageKey, JSON.stringify({ ...request, correcting: true }));
      setActiveKey(request.key); setLines(restored); setCurrency(body.moeda); setChannel(body.canal ?? "");
      const restoredMethod = splitPaymentMethod(body.formaPagamento);
      setMethod(restoredMethod.method); setOtherMethod(restoredMethod.other);
      setDate(localDateInput(body.vendidaEm)); setDiscount(formatMoneyInput(String(body.descontoVenda ?? "")));
      setPayment(body.pagamento.situacao); setReceived(formatMoneyInput(String(body.pagamento.valorRecebido ?? "")));
      setReceivedDate(body.pagamento.recebidoEm ? localDateInput(body.pagamento.recebidoEm) : "");
      setShowDiscount(body.descontoVenda !== "0.00"); setView("form"); setSelected(null); setStep(1);
      setInvalid(false); setError(""); setAttempted(true); setCanResend(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível retomar a correção."); }
  }
  async function recover() {
    if ((!pending && !activeKey) || !storageKey || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { const key = activeKey ?? readSavedRequest(pending!).key; setActiveKey(key);
      const sale = await fetchSale(`/by-request/${encodeURIComponent(key)}`); window.localStorage.setItem(`${storageKey}:id`, String(sale.id)); update(sale); clearSavedRequest(storageKey, key); setInvalid(false); setActiveKey(null); setCanResend(false); setMessage("Registro recuperado. Nenhuma baixa foi executada."); }
    catch (failure) { setCanResend(failure instanceof CommercialError && failure.status === 404);
      setError(failure instanceof CommercialError && failure.status === 404 ? "Venda ainda não encontrada. Você pode enviar o registro salvo, sem criar outra venda." : userMessage(failure, "Ainda não conseguimos confirmar esta venda. Confira o histórico antes de continuar.")); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function finishStock(sale: ExternalSale, generation = lifecycle.current) {
    const active = () => mounted.current && lifecycle.current === generation;
    if (!active() || !storageKey || !session?.baixasHabilitadas || session.usuarioId !== sale.usuarioId) return;
    setFinishing(true);
    try {
      await completeSaleStock(sale, stockProgressKey(storageKey, sale.id), value => {
        if (active()) update(value);
      }, active);
      if (active()) setStockNeedsCheck(null);
    } catch { if (active()) setStockNeedsCheck(sale.id); }
    finally {
      if (active()) {
        await carregarCatalogo().then(value => { if (active()) setCatalog(value); }).catch(() => {
          if (active()) setMessage("Não foi possível atualizar a consulta do inventário. Confira o saldo ao retornar.");
        });
        if (active()) setFinishing(false);
      }
    }
  }
  async function continueStock(sale: ExternalSale) {
    if (!storageKey || !session?.baixasHabilitadas || session.usuarioId !== sale.usuarioId || submitting.current) return;
    const generation = lifecycle.current;
    submitting.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const checked = await inspectSaleStock(sale, stockProgressKey(storageKey, sale.id));
      if (!mounted.current || lifecycle.current !== generation) return;
      window.localStorage.setItem(`${storageKey}:id`, String(checked.id));
      update(checked); setStockNeedsCheck(null); await finishStock(checked, generation);
    } catch { setStockNeedsCheck(sale.id); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function inspect(id: number) {
    if (submitting.current || !storageKey) return;
    const previous = selected?.id === id ? selected : sales.find(sale => sale.id === id);
    if (!previous) return;
    submitting.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const checked = await inspectSaleStock(previous, stockProgressKey(storageKey, id));
      window.localStorage.setItem(`${storageKey}:id`, String(checked.id)); update(checked); setStockNeedsCheck(null);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Consulta indisponível."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function cancel(sale: ExternalSale) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { update(await fetchSale(`/${sale.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })); setMessage("Venda cancelada. Recebimentos permanecem registrados e nenhum estoque foi reposto. Confira as baixas pendentes no histórico."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancelamento não confirmado."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function loadMore() {
    setBusy(true);
    try { const result = await listSales(page + 1); setSales(current => [...new Map([...current, ...result.items].map(sale => [sale.id, sale])).values()]); setPage(result.page); setMore(result.hasMore); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Histórico indisponível."); }
    finally { setBusy(false); }
  }
  return <div className={styles.container}>
    <header className={styles.header}>
      <div className={styles.actions}><h1 className={styles.title}>{view === "form" ? "Nova venda" : "Vendas externas"}</h1>
        {ready && session?.vendasExternasHabilitadas && view === "list" && <button className={styles.primaryButton} disabled={busy || !!pending || !!activeKey} onClick={startNew}>Nova venda</button>}
        {view === "form" && <button className={styles.secondaryButton} disabled={busy} onClick={() => { setView("list"); setConfirmCancel(false); }}>Voltar às vendas</button>}
      </div>
      {view === "list" && <p className={styles.subtitle}>WhatsApp, presencial e outros canais</p>}
    </header>
    {error && <p role="alert">{userMessage(error)}</p>}{message && <p role="status">{userMessage(message)}</p>}
    {loading ? <p role="status">Carregando vendas...</p> : !ready ? <div className={styles.notice}>
      <p>Não foi possível abrir as vendas.</p>
      <button className={styles.secondaryButton} type="button" onClick={() => { setError(""); setLoading(true); setLoadRevision(current => current + 1); }}>Carregar novamente</button>
      {!session && <Link href="/login">Entrar novamente</Link>}
    </div> : !session?.vendasExternasHabilitadas ? <div className={styles.notice}>
      <p>Vendas externas ainda não ativadas. Fale com o responsável pelo sistema.</p>
      <button className={styles.secondaryButton} type="button" onClick={() => { setLoading(true); setReady(false); setLoadRevision(current => current + 1); }}>Conferir disponibilidade</button>
    </div> : <>
      {(pending || activeKey) && <div role="alert" className={styles.notice}>
        <p>{correction ? "Há uma venda em correção. Continue este registro antes de começar outro." : "Ainda não conseguimos confirmar esta venda. Confira o registro antes de tentar novamente."}</p>
        <div className={styles.actions}><button className={styles.secondaryButton} disabled={busy} onClick={() => void recover()}>Conferir venda</button>
          {correction && !editing && <button className={styles.secondaryButton} disabled={busy} onClick={correctRequest}>Retomar correção</button>}
          {invalid && <button className={styles.secondaryButton} disabled={busy} onClick={correctRequest}>Corrigir dados da venda</button>}
          {canResend && pending && !correction && <button className={styles.secondaryButton} disabled={busy} onClick={() => void submit({ preventDefault() {} } as React.FormEvent)}>Enviar registro salvo</button>}
        </div>
      </div>}
      {view === "form" && <form onSubmit={submit} className={styles.salesForm} aria-busy={busy} noValidate>
        <ol className={styles.steps} aria-label="Etapas da venda">{["Produtos", "Valores", "Pagamento", "Conferir"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
        <fieldset disabled={busy || frozen}>
          <legend className={styles.stepTitle} tabIndex={-1} ref={stepTitle}>{["Escolha os produtos", "Confira quantidades e preços", "Canal e pagamento", "Resumo da venda"][step]}</legend>
          {step === 0 && <section className={styles.formSection}>
            <label>Produto e variante <select value={variant} onChange={event => setVariant(event.target.value)}><option value="">Selecione</option>
              {catalog.map(item => <option key={item.id} value={item.id}>{item.nome} · {item.variante} · {item.sku || "Sem SKU"}</option>)}</select></label>
            {catalog.find(item => item.id === variant) && <ProductPreview key={variant} item={catalog.find(item => item.id === variant)!} />}
            <button className={styles.secondaryButton} type="button" disabled={!variant || lines.some(line => line.item.id === variant) || lines.length >= 20} onClick={() => {
              const item = catalog.find(item => item.id === variant);
              if (item && !lines.some(line => line.item.id === item.id)) setLines(current => [...current, { item, quantidade: "1", preco: catalogMoney(item.preco), desconto: "0,00" }]);
            }}>Adicionar item</button>
            {!lines.length && <p className={styles.empty}>Selecione um produto para começar.</p>}
            {fieldError("itens")}
            {lines.map(line => <article key={line.item.id} className={styles.saleLine}><ProductPreview item={line.item} /><button className={styles.secondaryButton} type="button" onClick={() => setLines(current => current.filter(row => row.item.id !== line.item.id))}>Remover item</button></article>)}
          </section>}
          {step === 1 && <section className={styles.formSection}>
            {fieldError("itens")}
            {lines.map((line, index) => <article key={line.item.id} className={styles.saleLine}>
              <ProductPreview item={line.item} />
              <div className={styles.formGrid}>
                <label>Quantidade<input required inputMode="numeric" value={line.quantidade} aria-invalid={!!errors[`itens.${index}.quantidade`]} onChange={event => setLines(current => current.map((row, i) => i === index ? { ...row, quantidade: event.target.value } : row))} />{fieldError(`itens.${index}.quantidade`)}</label>
                <MoneyField label="Preço unitário" currency={currency} value={line.preco} error={errors[`itens.${index}.preco`]} onChange={value => setLines(current => current.map((row, i) => i === index ? { ...row, preco: value } : row))} />
              </div>
              <details open={!!errors[`itens.${index}.desconto`]}><summary>Desconto do item</summary><MoneyField label="Desconto do item" currency={currency} value={line.desconto} error={errors[`itens.${index}.desconto`]} onChange={value => setLines(current => current.map((row, i) => i === index ? { ...row, desconto: value } : row))} /></details>
              <p className={styles.lineTotal}>Total do item <output>{validation.lineTotals[index] === null ? "—" : formatMoney(validation.lineTotals[index], currency)}</output></p>
            </article>)}
            {showDiscount ? <MoneyField label="Desconto adicional da venda" currency={currency} value={discount} onChange={setDiscount} error={errors.descontoVenda} /> : <button className={styles.secondaryButton} type="button" onClick={() => setShowDiscount(true)}>Adicionar desconto</button>}
            <details open={!!errors.vendidaEm || !!errors.moeda}><summary>Moeda e data</summary><div className={styles.formGrid}>
              <label>Moeda <select value={currency} onChange={e => setCurrency(e.target.value)}>{["BRL", "USD", "EUR"].map(code => <option key={code}>{code}</option>)}</select></label>
              <label>Data da venda <input required type="datetime-local" value={date} aria-invalid={!!errors.vendidaEm} onChange={e => setDate(e.target.value)} />{fieldError("vendidaEm")}</label>
            </div></details>
          </section>}
          {step === 2 && <section className={styles.formSection}><div className={styles.formGrid}>
            <label>Canal <input required list="sales-channels" value={channel} aria-invalid={!!errors.canal} onChange={e => setChannel(e.target.value)} />{fieldError("canal")}</label>
            <datalist id="sales-channels"><option value="WhatsApp" /><option value="Presencial" /><option value="Instagram" /></datalist>
            <label>Forma de pagamento <select required value={method} aria-invalid={!!errors.formaPagamento} onChange={e => setMethod(e.target.value)}><option value="">Selecione</option>{PAYMENT_METHODS.map(value => <option key={value}>{value}</option>)}</select>{fieldError("formaPagamento")}</label>
            {method === "Outro" && <label>Qual forma de pagamento? <input value={otherMethod} maxLength={73} onChange={e => setOtherMethod(e.target.value)} /></label>}
            <label>Situação do pagamento <select value={payment} aria-invalid={!!paymentError} onBlur={() => setPaymentTouched(true)} onChange={e => setPayment(e.target.value)}><option value="pago">Pago</option><option value="pendente">Pendente</option><option value="parcial">Parcial</option></select>
              {paymentError && <small className={styles.fieldError} role="alert">{paymentError}</small>}</label>
            {payment === "parcial" && <MoneyField label="Valor recebido" currency={currency} value={received} onChange={setReceived} error={errors.valorRecebido} onBlur={() => setPaymentTouched(true)} />}
          </div>
            {payment !== "parcial" && <p>Valor recebido: <strong>{preview.total === null ? "—" : formatMoney(payment === "pago" ? preview.total : "0.00", currency)}</strong></p>}
            {payment !== "pendente" && preview.total !== "0.00" && <details open={!!errors.recebidoEm}><summary>Data do recebimento</summary><label>Data do recebimento <input type="datetime-local" value={receivedDate || date} aria-invalid={!!errors.recebidoEm} onChange={e => setReceivedDate(e.target.value)} />{fieldError("recebidoEm")}</label></details>}
          </section>}
          {step === 3 && <section className={styles.formSection}>
            {!session.baixasHabilitadas && <p role="alert">A atualização do estoque está desabilitada. Esta confirmação registrará somente a venda.</p>}
            {lines.map(line => <article key={line.item.id} className={styles.saleLine}><ProductPreview item={line.item} /><p>{countLabel(Number(line.quantidade), "unidade")} · {formatMoney(validation.lineTotals[lines.indexOf(line)] ?? "", currency)}</p></article>)}
            <p>{channel} · {form.formaPagamento} · {paymentLabel(payment)}</p>
            <p>Data da venda: {date ? new Date(date).toLocaleString("pt-BR") : "Não informada"}</p>
            <p>Valor recebido: <strong>{formatMoney(validation.body?.pagamento.valorRecebido ?? "", currency)}</strong></p>
            {validation.body?.pagamento.recebidoEm && <p>Recebido em: {new Date(validation.body.pagamento.recebidoEm).toLocaleString("pt-BR")}</p>}
            {Object.keys(errors).length > 0 && <p role="alert">Confira os dados nas etapas anteriores antes de confirmar.</p>}
          </section>}
          {step > 0 && <section className={styles.formSection} aria-label="Totais da venda"><div className={styles.saleTotals}>
            <span>Subtotal</span><output>{validation.subtotal === null ? "—" : formatMoney(validation.subtotal, currency)}</output>
            <span>Descontos aplicados</span><output>{validation.discounts === null ? "—" : formatMoney(validation.discounts, currency)}</output>
            <strong>Total final</strong><output className={styles.totalValue}>{validation.total === null ? "—" : formatMoney(validation.total, currency)}</output>
          </div>{validation.total === "0.00" && <p>Total zero: pago, sem recebimento a registrar.</p>}</section>}
        </fieldset>
        <div className={styles.wizardActions}>
          {step > 0 && <button className={styles.secondaryButton} type="button" disabled={busy || frozen} onClick={() => { setStep(current => current - 1); setAttempted(false); }}>Voltar</button>}
          {step < 3 ? <button className={styles.primaryButton} type="button" disabled={busy || frozen} onClick={advance}>Continuar</button> : <button className={styles.primaryButton} type="submit" disabled={busy || frozen}>{busy ? "Registrando..." : editing ? "Confirmar correção" : "Confirmar venda"}</button>}
        </div>
        {!pending && !activeKey && <button className={styles.textButton} disabled={busy} type="button" onClick={discard}>Descartar preenchimento</button>}
      </form>}
      {view === "detail" && selected && <section className={styles.saleDetails} aria-busy={finishing}>
        <div className={styles.formSection}>
          <h2>{finishing ? "Concluindo venda..." : selected.situacao === "cancelada" ? "Venda cancelada" : completed ? "Venda concluída" : "Venda registrada"}</h2>
          <strong className={styles.totalValue}>{formatMoney(selected.total, selected.moeda)}</strong>
          <p>{selected.canal} · {selected.formaPagamento} · {paymentLabel(selected.situacaoPagamento)}</p>
          {finishing && <p role="status">Atualizando o estoque. Aguarde a confirmação.</p>}
          {!finishing && !completed && selected.situacao !== "cancelada" && <div className={styles.stockAttention} role="alert">
            <p>Venda registrada. A atualização do estoque precisa de atenção.</p>
            {!session.baixasHabilitadas && <p>A atualização do estoque está desabilitada. Fale com o responsável pelo sistema.</p>}
            {needsStockInspection || !session.baixasHabilitadas
              ? <button className={styles.secondaryButton} disabled={busy} onClick={() => void inspect(selected.id)}>Conferir atualização</button>
              : requiresStockReview(selected) || !hasReadyItems(selected) || selected.usuarioId !== session.usuarioId
                ? <Link href="/history">Conferir baixas</Link>
                : <button className={styles.secondaryButton} disabled={busy} onClick={() => void continueStock(selected)}>Concluir atualização do estoque</button>}
          </div>}
        </div>
        {selected.itens.map(item => {
          const current = catalog.find(row => row.produtoId === item.produtoId && row.varianteId === item.varianteId);
          return <article className={styles.card} key={item.id}>
            <ProductPreview compact item={{ ...current, nome: item.nomeProduto, variante: item.nomeVariante, sku: item.sku, quantidade: current?.quantidade }} />
            <span>{countLabel(item.quantidade, "unidade")} · {formatMoney(item.total, selected.moeda)}</span>
          </article>;
        })}
        {financialPending && <p role="alert">Há um recebimento ou estorno sem confirmação. Confira em Ver detalhes.</p>}
        <details className={styles.formSection} open={!!financialPending || confirmCancel || selected.situacaoPagamento !== "pago"}>
          <summary>Ver detalhes</summary>
          <p>Venda #{selected.id} · {new Date(selected.vendidaEm).toLocaleString("pt-BR")}</p>
          <p>Subtotal: {formatMoney(selected.subtotal, selected.moeda)} · Descontos dos itens: {formatMoney(selected.descontosItens, selected.moeda)} · Desconto adicional: {formatMoney(selected.descontoVenda, selected.moeda)}</p>
          {selected.itens.map(item => <p key={item.id}>{item.nomeProduto} · {item.nomeVariante}: {stockLabels[item.estoque] ?? "A conferir"}{item.baixaId ? ` · Baixa #${item.baixaId}` : ""}</p>)}
          <p>Recebido: {formatMoney(selected.valorRecebido, selected.moeda)} · Estornado: {formatMoney(selected.valorEstornado, selected.moeda)}</p>
          {selected.movimentos.map(event => <p key={event.id}>{event.tipo === "recebimento" ? "Recebimento" : "Estorno"}: {formatMoney(event.valor, selected.moeda)} · {new Date(event.ocorridoEm).toLocaleString("pt-BR")}</p>)}
          <fieldset className={styles.resultOptions} disabled={busy}>
            <legend>Outras ações</legend>
            {session.usuarioId === selected.usuarioId && <FinancialForm key={selected.id} sale={selected} session={session} onChange={update} />}
            {session.usuarioId === selected.usuarioId && selected.situacao !== "cancelada" && (confirmCancel ? <div role="alert" className={styles.notice}>
              <p>Cancelar esta venda? Os recebimentos serão mantidos e o estoque não será reposto.</p>
              <div className={styles.actions}><button className={styles.dangerButton} disabled={busy} onClick={() => void cancel(selected)}>Confirmar cancelamento</button><button className={styles.secondaryButton} disabled={busy} onClick={() => setConfirmCancel(false)}>Manter venda</button></div>
            </div> : <button className={styles.dangerButton} disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar venda</button>)}
          </fieldset>
        </details>
        <div className={styles.actions}>
          <button className={styles.primaryButton} disabled={busy || !!pending || !!activeKey} onClick={startNew}>Nova venda</button>
          <button className={styles.secondaryButton} disabled={busy} onClick={() => setView("list")}>Ver vendas</button>
        </div>
      </section>}
      {view === "list" && <section className={styles.salesHistory}><h2>Histórico</h2>
        {!sales.length && <p className={styles.empty}>Nenhuma venda registrada.</p>}
        {sales.map(sale => <article className={styles.card} key={sale.id}><strong>Venda #{sale.id} · {sale.canal}</strong><strong>{formatMoney(sale.total, sale.moeda)}</strong>
          <p>{new Date(sale.vendidaEm).toLocaleDateString("pt-BR")} · {sale.situacao === "cancelada" ? "Cancelada" : `Pagamento: ${paymentLabel(sale.situacaoPagamento)}`} · Estoque: {stockLabels[sale.estoque] ?? "A conferir"}</p>
          <button className={styles.secondaryButton} disabled={busy} onClick={() => void inspect(sale.id)}>Ver venda</button></article>)}
        {more && <button className={styles.secondaryButton} disabled={busy} onClick={() => void loadMore()}>Carregar mais vendas</button>}
      </section>}
    </>}
    <TabBar />
  </div>;
}
