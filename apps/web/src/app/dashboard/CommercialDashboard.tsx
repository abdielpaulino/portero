"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { carregarSessao, type Session } from "../auth/session";
import { fetchOrders, fetchSummary, formatMoney, monthNow, type OnlineOrder, type DashboardSummary } from "../sales/data";
import { countLabel, paymentLabel } from "../components/presentation";
import type { DashboardData } from "./data";
import DailyCommercialChart from "./DailyCommercialChart";
import ManagementCharts from "./ManagementCharts";
import { dashboardFigures, formatUnits, periodLabel } from "./management";
import styles from "./dashboard.module.css";

type Props = { revision?: number; inventory?: DashboardData | null; stockLoading?: boolean; stockError?: string; limit?: number };
export default function CommercialDashboard({ revision = 0, inventory, stockLoading = false, stockError = "", limit = 0 }: Props) {
  const [session, setSession] = useState<Session | null>(null), [checked, setChecked] = useState(false);
  const [period, setPeriod] = useState(monthNow), [currency, setCurrency] = useState("BRL");
  const [external, setExternal] = useState<DashboardSummary | null>(null), [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [externalError, setExternalError] = useState(""), [onlineError, setOnlineError] = useState("");
  const [page, setPage] = useState(0), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setSession(value); setChecked(true); } })
      .catch(() => { if (!controller.signal.aborted) { setExternalError("Não foi possível carregar o resumo de vendas."); setChecked(true); } });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    if (session?.vendasExternasHabilitadas) void fetchSummary(period, controller.signal).then(value => {
      if (!controller.signal.aborted && current === generation.current) { setExternal(value); setExternalError(""); }
    }).catch(() => { if (!controller.signal.aborted && current === generation.current) { setExternal(null); setExternalError("Vendas externas ainda não disponíveis."); } });
    if (session?.pedidosOnlineHabilitados) void fetchOrders(period, 1, controller.signal).then(value => {
      if (!controller.signal.aborted && current === generation.current) { setOrders(value.items); setPage(1); setMore(value.hasMore); setOnlineError(""); setBusy(false); }
    }).catch(() => { if (!controller.signal.aborted && current === generation.current) { setOrders([]); setPage(0); setMore(false); setBusy(false); setOnlineError("Pedidos online ainda não disponíveis."); } });
    return () => controller.abort();
  }, [session, period, revision]);
  function changePeriod(value: string) {
    if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) || busy) return;
    setExternal(null); setOrders([]); setPage(0); setMore(false); setExternalError(""); setOnlineError(""); setPeriod(value);
  }
  async function next() {
    if (busy) return; setBusy(true); setOnlineError(""); const current = generation.current;
    try {
      const result = await fetchOrders(period, page + 1);
      if (current !== generation.current) return;
      setOrders(previous => [...new Map([...previous, ...result.items].map(order => [`${order.storeId}:${order.id}`, order])).values()]);
      setPage(result.page); setMore(result.hasMore);
    } catch { if (current === generation.current) setOnlineError("Não foi possível carregar mais pedidos. Dados incompletos."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  if (!session?.vendasExternasHabilitadas && !session?.pedidosOnlineHabilitados && inventory === undefined) return externalError ? <p role="alert">{externalError}</p> : null;
  const currentExternal = external?.periodo === period ? external : null;
  const currencies = [...new Set([...(currentExternal?.totais.map(row => row.moeda) ?? []), ...orders.map(row => row.moeda).filter((value): value is string => !!value && /^[A-Z]{3}$/.test(value))])].sort();
  if (!currencies.length) currencies.push("BRL");
  const selectedCurrency = currencies.includes(currency) ? currency : currencies[0];
  const figures = dashboardFigures(currentExternal, orders, page > 0, selectedCurrency, period);
  const partial = figures.incomplete || more || !!onlineError && page > 0;
  const loadingSales = !checked || !!session?.vendasExternasHabilitadas && !currentExternal && !externalError || !!session?.pedidosOnlineHabilitados && !page && !onlineError;
  const money = (value: string | null) => value === null ? loadingSales ? "Carregando..." : "Indisponível" : formatMoney(value, selectedCurrency);
  const scope = figures.externalValue !== null && figures.onlineValue !== null ? "Vendas externas + pedidos online" : figures.externalValue !== null ? "Somente vendas externas" : figures.onlineValue !== null ? "Somente pedidos online" : "";
  const attentionCount = currentExternal?.gestao?.vendasComPendencia;
  const lowProducts = inventory ? [...new Map(inventory.catalogo.filter(row => row.quantidade !== null && row.quantidade <= limit).map(row => [row.produtoId, row])).values()] : [];
  return <div className={styles.overview}>
    <section className={styles.filters} aria-label="Período e moeda">
      <label>Período<input type="month" min="0001-01" value={period} disabled={busy} onChange={event => changePeriod(event.target.value)} /></label>
      <button type="button" aria-pressed={period === monthNow()} disabled={busy} onClick={() => changePeriod(monthNow())}>Este mês</button>
      <label>Moeda<select value={selectedCurrency} onChange={event => setCurrency(event.target.value)}>{currencies.map(value => <option key={value}>{value}</option>)}</select></label>
    </section>
    <p className={styles.periodTitle}>{periodLabel(period)}</p>
    {externalError && <p role="alert">{externalError}</p>}
    {checked && !session?.vendasExternasHabilitadas && <p className={styles.scope}>Vendas externas ainda não disponíveis.</p>}
    {onlineError && <p role="alert">{onlineError}</p>}
    {checked && !session?.pedidosOnlineHabilitados && <p className={styles.scope}>Pedidos online ainda não disponíveis.</p>}
    {partial && <p role="alert">Dados incompletos. {more ? "Há mais pedidos online para carregar." : "Alguns pedidos ficaram fora dos valores."}</p>}
    {more && <button className={styles.refreshButton} disabled={busy} onClick={() => void next()}>{busy ? "Carregando..." : "Carregar mais pedidos"}</button>}
    <section className={styles.indicatorGrid} aria-label="Principais indicadores">
      <article className={styles.statCard}><h2>Valor vendido</h2><strong>{money(figures.sold)}</strong><span>{scope}{partial && " · Parcial"}</span><small>Sem frete · não é valor recebido</small></article>
      <article className={styles.statCard}><h2>Recebido nas vendas externas</h2><strong>{money(figures.received)}</strong><span>Recebimentos menos estornos no período</span></article>
      <article className={styles.statCard}><h2>A receber nas vendas externas</h2><strong>{money(figures.outstanding)}</strong><span>Vendas do período · saldo atual</span></article>
      <article className={styles.statCard}><h2>Vendas e pedidos</h2><strong>{figures.count === null ? loadingSales ? "Carregando..." : "Indisponível" : figures.count.toLocaleString("pt-BR")}</strong>
        <span>Vendas externas: {figures.externalSales ?? "indisponível"}</span><span>Pedidos online: {figures.onlineOrders ?? "indisponível"}{partial && " · Parcial"}</span></article>
      <article className={styles.statCard}><h2>Unidades vendidas</h2><strong>{formatUnits(figures.units)}</strong><span>Somente vendas externas</span></article>
      <article className={styles.statCard}><h2>Produtos com estoque baixo</h2><strong>{stockLoading ? "Carregando..." : inventory ? inventory.produtosBaixos : "Indisponível"}</strong>
        <span>Estoque atual · inclui esgotados</span>{inventory && <small>{countLabel(inventory.emRuptura, "variante com saldo baixo", "variantes com saldo baixo")}</small>}</article>
    </section>
    {stockError && <p role="alert">Estoque ainda não disponível.</p>}
    <section className={styles.card} aria-label="Vendas no período">
      <DailyCommercialChart period={period} external={currentExternal} orders={orders} onlineLoaded={page > 0} onlinePartial={partial}
        externalEnabled={!!session?.vendasExternasHabilitadas} onlineEnabled={!!session?.pedidosOnlineHabilitados} page={page} currency={selectedCurrency} />
    </section>
    <ManagementCharts figures={figures} currency={selectedCurrency} inventory={inventory} />
    {page > 0 && <details className={styles.card}><summary>Ver pedidos online</summary>{orders.map(order => <p key={`${order.storeId}:${order.id}`}>Pedido #{order.numero} · {new Date(order.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {order.status === "cancelled" ? "Cancelado" : paymentLabel(order.pagamento)} · {order.valorProdutos !== null && order.moeda ? formatMoney(order.valorProdutos, order.moeda) : "Valor indisponível"}</p>)}</details>}
    <section className={styles.card} aria-label="Precisa de atenção"><h2>Precisa de atenção</h2>
      {!currentExternal && !inventory && <p>As pendências ainda não estão disponíveis.</p>}
      {attentionCount !== undefined ? attentionCount > 0 ? <div className={styles.attention}><strong>{countLabel(attentionCount, "venda precisa de atenção", "vendas precisam de atenção")}</strong><span>Vendas externas · todas as moedas · {periodLabel(period)}</span><Link href="/sales">Conferir vendas</Link></div> : <p>Nenhuma pendência nas vendas externas deste período.</p>
        : currentExternal && (currentExternal.estoque.pendentes > 0 || currentExternal.totais.some(row => row.pagamentosPendentes > 0)) ? <div className={styles.attention}><p>Há vendas externas a conferir.</p><Link href="/sales">Conferir vendas</Link></div> : null}
      {inventory && inventory.produtosBaixos > 0 && <div className={styles.attention}><strong>{countLabel(inventory.produtosBaixos, "produto com estoque baixo", "produtos com estoque baixo")}</strong>
        {lowProducts.slice(0, 3).map(row => <Link key={row.produtoId} href={`/productDetails/${row.produtoId}?varianteId=${row.varianteId}`}>{row.nome}</Link>)}
        <Link href="/inventory">Ver estoque</Link>{inventory.negativas > 0 && <span>{countLabel(inventory.negativas, "variante com saldo negativo", "variantes com saldo negativo")}. Confira o estoque.</span>}</div>}
      {inventory && inventory.produtosBaixos === 0 && <p>Nenhum produto com estoque baixo.</p>}
    </section>
  </div>;
}
