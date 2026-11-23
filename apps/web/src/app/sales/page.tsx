"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import { carregarSessao, type Session } from "../auth/session";
import { carregarCatalogo, type Item } from "../inventory/data";
import { CommercialError, commercialFetch, fetchSale, formatMoney, isSale, listSales, type ExternalSale, type SaleDraft } from "./data";
import { clearPending, savePending, usePending } from "./pending";
import FinancialForm from "./FinancialForm";
import styles from "../inventory/inventory.module.css";

type Line = { item: Item; quantidade: string; preco: string; desconto: string };
export default function SalesPage() {
  const [session, setSession] = useState<Session | null>(null), [catalog, setCatalog] = useState<Item[]>([]);
  const [sales, setSales] = useState<ExternalSale[]>([]), [selected, setSelected] = useState<ExternalSale | null>(null);
  const [lines, setLines] = useState<Line[]>([]), [variant, setVariant] = useState("");
  const [channel, setChannel] = useState(""), [method, setMethod] = useState(""), [currency, setCurrency] = useState("BRL");
  const [date, setDate] = useState(""), [discount, setDiscount] = useState("0.00"), [payment, setPayment] = useState("pendente");
  const [received, setReceived] = useState("0.00"), [receivedDate, setReceivedDate] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [page, setPage] = useState(1), [more, setMore] = useState(false), [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [loadRevision, setLoadRevision] = useState(0);
  const submitting = useRef(false);
  const storageKey = session ? `portero:venda:${session.loja.id}:${session.usuarioId}` : null;
  const pending = usePending(storageKey);
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
  function update(sale: ExternalSale) { setSelected(sale); setSales(current => [sale, ...current.filter(item => item.id !== sale.id)]); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!session || !storageKey || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setMessage("");
    try {
      let saved = window.localStorage.getItem(storageKey);
      if (!saved) {
        const body: SaleDraft = { canal: channel, formaPagamento: method, moeda: currency, vendidaEm: new Date(date).toISOString(), descontoVenda: discount,
          pagamento: { situacao: payment, valorRecebido: received, ...(received !== "0.00" && received !== "0" ? { recebidoEm: new Date(receivedDate).toISOString() } : {}) },
          itens: lines.map(line => ({ produtoId: line.item.produtoId, varianteId: line.item.varianteId, quantidade: Number(line.quantidade), precoUnitario: line.preco, desconto: line.desconto })) };
        saved = JSON.stringify({ key: crypto.randomUUID(), body }); savePending(storageKey, saved);
      }
      const request = JSON.parse(saved);
      const sale = await fetchSale("", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
      window.localStorage.setItem(`${storageKey}:id`, String(sale.id)); update(sale); clearPending(storageKey); setLines([]);
      setMessage("Venda registrada no PORTERO. Pagamento informado não é processado pela integração. Sincronize os itens separadamente.");
    } catch (failure) { setInvalid(failure instanceof CommercialError && failure.status === 400); setError(failure instanceof Error ? failure.message : "Registro não confirmado. Preserve a mesma requisição."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function recover() {
    if (!pending || !storageKey || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { const request = JSON.parse(pending); const sale = await fetchSale(`/by-request/${encodeURIComponent(request.key)}`); window.localStorage.setItem(`${storageKey}:id`, String(sale.id)); update(sale); clearPending(storageKey); setMessage("Registro recuperado. Nenhuma baixa foi executada."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Recuperação não confirmada."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function execute(sale: ExternalSale, itemId: number) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const { response, data } = await commercialFetch(`external/${sale.id}/items/${itemId}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = data as { venda?: unknown; message?: string } | null;
      if (isSale(result?.venda)) update(result.venda);
      setMessage(result?.message ?? "Execução não confirmada. Atualize a mesma venda antes de continuar.");
      if (response.ok) await carregarCatalogo().then(setCatalog).catch(() => setMessage("Resultado do item registrado. Atualize o inventário ao retornar."));
    } catch { setError("Resposta da execução perdida. Consulte a mesma venda; não crie outra para repetir os itens."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function inspect(id: number) {
    setBusy(true); setError("");
    try { update(await fetchSale(`/${id}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Consulta indisponível."); }
    finally { setBusy(false); }
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
    <div className={styles.header}><h1 className={styles.title}>Vendas externas</h1><p className={styles.subtitle}>Registro financeiro no PORTERO; na Nuvemshop, somente estoque.</p>
      <Link href="/inventory">Inventário</Link>{" · "}<Link href="/history">Histórico de baixas</Link>{" · "}<Link href="/dashboard">Dashboard</Link></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Verificando disponibilidade e carregando vendas externas...</p> : !ready ? <div>
      <p>Não foi possível abrir o registro comercial. Esta consulta não cria vendas nem executa baixas.</p>
      <button type="button" onClick={() => { setError(""); setLoading(true); setLoadRevision(current => current + 1); }}>Tentar carregar novamente</button>
      {!session && <Link href="/login">Entrar novamente</Link>}
    </div> : !session?.vendasExternasHabilitadas ? <div>
      <p>Registro comercial ainda não ativado nesta instalação. Solicite à administração a conferência e habilitação do recurso. O inventário e o histórico de baixas continuam disponíveis.</p>
      <button type="button" onClick={() => { setLoading(true); setReady(false); setLoadRevision(current => current + 1); }}>Conferir disponibilidade novamente</button>
    </div> : <>
      <form onSubmit={submit} className={styles.list}>
        <fieldset disabled={busy || !!pending || !!selected}>
          <legend>Registrar venda</legend>
          <label>Produto e variante <select value={variant} onChange={e => setVariant(e.target.value)}><option value="">Selecione</option>
            {catalog.map(item => <option key={item.id} value={item.id}>{item.nome} · {item.variante} · {item.sku || "Sem SKU"}</option>)}</select></label>{" "}
          <button type="button" onClick={() => { const item = catalog.find(item => item.id === variant); if (item && !lines.some(line => line.item.id === item.id)) setLines(current => [...current, { item, quantidade: "1", preco: item.preco?.toFixed(2) ?? "", desconto: "0.00" }]); }}>Adicionar item</button>
          <p>Confirme o preço efetivo. Os valores serão preservados na venda; não há cotação de frete.</p>
          {lines.map((line, index) => <div key={line.item.id} className={styles.card}>
            <span>{line.item.nome} · {line.item.variante}</span>
            {(["quantidade", "preco", "desconto"] as const).map(field => <label key={field}>{field === "preco" ? "Preço unitário" : field === "desconto" ? "Desconto do item" : "Quantidade"}
              <input required inputMode={field === "quantidade" ? "numeric" : "decimal"} value={line[field]} onChange={e => setLines(current => current.map((row, i) => i === index ? { ...row, [field]: e.target.value } : row))} /></label>)}
            <button type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>Remover item</button>
          </div>)}
          <label>Canal <input required list="sales-channels" value={channel} onChange={e => setChannel(e.target.value)} /></label>
          <datalist id="sales-channels"><option value="WhatsApp" /><option value="Presencial" /><option value="Instagram" /></datalist>{" "}
          <label>Forma de pagamento <input required value={method} onChange={e => setMethod(e.target.value)} placeholder="Pix, dinheiro, cartão..." /></label>{" "}
          <label>Moeda <select value={currency} onChange={e => setCurrency(e.target.value)}>{["BRL", "USD", "EUR"].map(code => <option key={code}>{code}</option>)}</select></label>{" "}
          <label>Data da venda (fuso do navegador) <input required type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></label>{" "}
          <label>Desconto adicional da venda <input required inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value)} /></label>{" "}
          <label>Situação informada <select value={payment} onChange={e => setPayment(e.target.value)}><option value="pendente">Pendente</option><option value="parcial">Parcial</option><option value="pago">Pago</option></select></label>{" "}
          <label>Valor recebido informado <input required inputMode="decimal" value={received} onChange={e => setReceived(e.target.value)} /></label>{" "}
          <label>Data do recebimento (se houver) <input type="datetime-local" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} /></label>
        </fieldset>
        {!selected && <button type="submit" disabled={busy || (!pending && !lines.length)} formNoValidate={!!pending}>{pending ? "Reenviar a mesma requisição" : "Registrar venda no PORTERO"}</button>}
      </form>
      {pending && <div role="alert"><p>Há uma requisição salva. Não registre a mesma venda com outra chave.</p><button disabled={busy} onClick={() => void recover()}>Recuperar registro pela chave</button></div>}
      {invalid && storageKey && <button disabled={busy} onClick={() => { clearPending(storageKey); setInvalid(false); }}>Corrigir solicitação recusada como inválida</button>}
      {selected && <section className={styles.list}>
        <h2>Venda #{selected.id} · {selected.canal}</h2><p>{formatMoney(selected.total, selected.moeda)} · {selected.situacao} · pagamento {selected.situacaoPagamento} · estoque {selected.estoque}</p>
        <p>Registro financeiro e estoque são independentes. Resultado parcial ou incerto exige conferência.</p>
        <button disabled={busy} onClick={() => void inspect(selected.id)}>Consultar a mesma venda</button>
        {selected.itens.map(item => <article className={styles.card} key={item.id}><span>{item.nomeProduto} · {item.nomeVariante} · {item.quantidade} un. · {formatMoney(item.total, selected.moeda)}</span>
          <span>Baixa {item.baixaId ?? "não solicitada"}: {item.estoque}</span>
          {session.usuarioId === selected.usuarioId && selected.situacao === "confirmada" && ["nao_solicitada", "registrada"].includes(item.estoque) &&
            <button disabled={busy || !session.baixasHabilitadas} onClick={() => void execute(selected, item.id)}>Sincronizar este item</button>}
          {!["nao_solicitada", "registrada", "sincronizada"].includes(item.estoque) && <p role="alert">Não reenviar. Solicite conferência desta baixa.</p>}
        </article>)}
        {session.usuarioId === selected.usuarioId && <><FinancialForm key={selected.id} sale={selected} session={session} onChange={update} />
          {selected.situacao !== "cancelada" && <button disabled={busy} onClick={() => void cancel(selected)}>Cancelar venda, sem repor estoque</button>}</>}
        {selected.movimentos.map(event => <p key={event.id}>{event.tipo}: {formatMoney(event.valor, selected.moeda)} · {new Date(event.ocorridoEm).toLocaleString("pt-BR")}</p>)}
        <button disabled={busy || !!pending} onClick={() => { setSelected(null); setMessage(""); }}>Preparar outra venda</button>
      </section>}
      <h2>Histórico comercial — PORTERO</h2>
      {sales.map(sale => <article className={styles.card} key={sale.id}><span>#{sale.id} · {sale.canal} · {formatMoney(sale.total, sale.moeda)} · pagamento {sale.situacaoPagamento} · estoque {sale.estoque}</span>
        <button disabled={busy} onClick={() => void inspect(sale.id)}>Ver venda</button></article>)}
      {more && <button disabled={busy} onClick={() => void loadMore()}>Carregar mais vendas</button>}
    </>}
    <TabBar />
  </div>;
}
