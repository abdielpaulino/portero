"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { carregarSessao, type Session } from "../auth/session";
import { fetchOrders, fetchSummary, formatMoney, monthNow, onlineTotals, type OnlineOrder, type Summary } from "../sales/data";
import styles from "./dashboard.module.css";

export default function CommercialDashboard({ revision = 0 }: { revision?: number }) {
  const [session, setSession] = useState<Session | null>(null), [period, setPeriod] = useState(monthNow);
  const [external, setExternal] = useState<Summary | null>(null), [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [externalError, setExternalError] = useState(""), [onlineError, setOnlineError] = useState("");
  const [page, setPage] = useState(0), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setSession(value); })
      .catch(() => { if (!controller.signal.aborted) setExternalError("Não foi possível verificar a disponibilidade dos indicadores comerciais."); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    if (session?.vendasExternasHabilitadas) void fetchSummary(period, controller.signal).then(value => { if (!controller.signal.aborted) { setExternal(value); setExternalError(""); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setExternal(null); setExternalError(error instanceof Error ? error.message : "Resumo externo indisponível."); } });
    if (session?.pedidosOnlineHabilitados) void fetchOrders(period, 1, controller.signal).then(value => {
      if (!controller.signal.aborted && current === generation.current) { setOrders(value.items); setPage(1); setMore(value.hasMore); setOnlineError(""); setBusy(false); }
    }).catch((error: unknown) => { if (!controller.signal.aborted && current === generation.current) { setOrders([]); setPage(0); setMore(false); setBusy(false); setOnlineError(error instanceof Error ? error.message : "Pedidos indisponíveis."); } });
    return () => controller.abort();
  }, [session, period, revision]);
  async function next() {
    if (busy) return; setBusy(true); setOnlineError("");
    const current = generation.current;
    try {
      const result = await fetchOrders(period, page + 1);
      if (current !== generation.current) return;
      setOrders(current => [...new Map([...current, ...result.items].map(order => [`${order.storeId}:${order.id}`, order])).values()]);
      setPage(result.page); setMore(result.hasMore);
    } catch (error) { if (current === generation.current) setOnlineError(error instanceof Error ? error.message : "Consulta interrompida; totais continuam parciais."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  if (!session?.vendasExternasHabilitadas && !session?.pedidosOnlineHabilitados) return externalError ? <p role="alert">{externalError}</p> : null;
  return <section className={styles.card}>
    <h2 className={styles.cardLabel}>Vendas e pedidos por origem</h2>
    <label>Período <input type="month" value={period} disabled={busy} onChange={event => {
      setExternal(null); setOrders([]); setPage(0); setMore(false); setExternalError(""); setOnlineError(""); setPeriod(event.target.value);
    }} /></label>
    <p className={styles.cardHint}>America/Sao_Paulo · valores sem frete · moedas separadas. Valor vendido e valor dos pedidos não representam dinheiro recebido.</p>
    {session.vendasExternasHabilitadas && <div>
      <h3>Vendas externas — PORTERO</h3><Link href="/sales">Registrar venda e consultar histórico comercial</Link>
      {externalError && <p role="alert">{externalError}</p>}
      {!external && !externalError && <p role="status">Carregando registros externos...</p>}
      {external && <>
        <p>Todos os registros locais do período {external.periodo}. Vendas confirmadas pela data da venda; recebimentos e estornos pela data do movimento.</p>
        {!external.totais.length && <p>Nenhum registro financeiro para este período.</p>}
        {external.totais.map(row => <div className={styles.orderRow} key={`${row.moeda}:${row.canal}`}>
          <div className={styles.orderInfo}><strong>{row.canal} · {row.moeda}</strong>
            <p>{row.vendas} venda(s) confirmada(s) · {row.pagamentosPendentes} com saldo a receber</p>
            <p>Valor vendido: {formatMoney(row.valorVendido, row.moeda)}</p>
            <p>Recebimentos informados: {formatMoney(row.recebimentos, row.moeda)} · estornos: {formatMoney(row.estornos, row.moeda)}</p>
            <p>Recebido líquido no mês: {formatMoney(row.recebidoLiquido, row.moeda)}</p>
          </div></div>)}
        <p>{external.estoque.pendentes} item(ns) com estoque pendente ou parcial; {external.estoque.incertas} exigem conferência.</p>
      </>}
    </div>}
    {session.pedidosOnlineHabilitados && <div>
      <h3>Pedidos da loja online — Nuvemshop</h3>
      <p>Período {period}, pela criação do pedido. Canal: loja online. Esta consulta não altera estoque.</p>
      {onlineError && <p role="alert">{onlineError}</p>}
      {!page && !onlineError && <p role="status">Consultando pedidos...</p>}
      {page > 0 && <>
        <p>{orders.length} pedido(s) nas páginas 1 a {page}. {more ? "Totais parciais: há outras páginas para consultar." : "Fim da paginação informado pela API."}</p>
        {onlineTotals(orders).map(row => <div key={row.moeda}>
          <strong>{row.moeda} · valor dos pedidos: {formatMoney(row.valor, row.moeda)}</strong>
          <p>{row.pedidos} pedido(s) não cancelados; {row.pendentes} com pagamento pendente/parcial.</p>
          {row.incompletos > 0 && <p role="alert">{row.incompletos} registro(s) sem dados suficientes: o total monetário é incompleto.</p>}
        </div>)}
        <p>Recebido online no mês indisponível: a consulta não comprova recebimentos e estornos datados. Não foi estimado pelo status pago.</p>
        {orders.map(order => <div className={styles.orderRow} key={`${order.storeId}:${order.id}`}><span>Pedido #{order.numero} · Nuvemshop/loja online · {order.status} · pagamento {order.pagamento}
          {order.valorProdutos !== null && order.moeda ? ` · ${formatMoney(order.valorProdutos, order.moeda)} sem frete` : " · valor incompleto"}</span></div>)}
        {more && <button type="button" disabled={busy} onClick={() => void next()}>Consultar mais pedidos</button>}
      </>}
    </div>}
  </section>;
}
