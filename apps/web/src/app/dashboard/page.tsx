"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import styles from "./dashboard.module.css";
import { carregarDashboard, type DashboardData } from "./data";
import { statusLabel } from "../history/data";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void carregarDashboard(controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar os indicadores.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    function refresh() {
      if (!loading && document.visibilityState === "visible") {
        setData(null); setError(""); setLoading(true); setRevision(current => current + 1);
      }
    }
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [loading]);

  function atualizar() { setData(null); setError(""); setLoading(true); setRevision(current => current + 1); }
  return <div className={styles.container} aria-busy={loading}>
    <div className={styles.header}>
      <div><h1 className={styles.title}>Fluxo do estoque</h1><p className={styles.subtitle}>Inventário e baixas da loja</p></div>
      <button className={styles.refreshButton} type="button" disabled={loading} onClick={atualizar}>Atualizar</button>
    </div>
    {loading && <p className={styles.notice} role="status">Carregando indicadores...</p>}
    {error && <p className={styles.notice} role="alert">{error} <Link href="/login">Entrar novamente</Link></p>}
    {data && <>
      <p className={styles.notice}>Contagem de todas as páginas consultadas do catálogo. <Link href="/inventory">Ver inventário</Link></p>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}><span className={styles.statLabel}>Produtos carregados</span><span className={styles.statValue}>{data.produtos}</span></div>
        <div className={styles.statCard}><span className={styles.statLabel}>Variantes carregadas</span><span className={styles.statValue}>{data.variantes}</span></div>
      </div>
      <div className={styles.card}>
        <span className={styles.cardLabel}>Situação das variantes carregadas</span>
        <div className={styles.alertRow}><span className={styles.alertValue}>{data.semEstoque}</span><span>sem estoque disponível</span></div>
        <p className={styles.cardHint}>{data.semControle} sem controle de estoque — contadas separadamente.</p>
        {data.negativas > 0 && <p className={styles.notice} role="alert">{data.negativas} variante(s) com estoque negativo — solicitar conferência.</p>}
      </div>
      <div className={styles.card}>
        <div className={styles.cardHeaderRow}><span className={styles.cardLabel}>Baixas recentes</span><Link href="/history">Ver histórico</Link></div>
        <div className={styles.orderList}>
          {!data.recentes.length && <p>Nenhuma baixa registrada.</p>}
          {data.recentes.map(item => <div key={item.id} className={styles.orderRow}>
            <div className={styles.orderInfo}>
              <span className={styles.orderNumber}>Baixa #{item.id} · {item.quantidade} un.</span>
              <span className={styles.orderMeta}>Variante {item.varianteId} · {item.sku || "Sem SKU"}</span>
              <small className={styles.orderMeta}>{new Date(item.criadoEm).toLocaleString("pt-BR")}</small>
            </div>
            <span className={styles.statusBadge} data-status={item.status}>{statusLabel(item.status)}</span>
          </div>)}
        </div>
      </div>
    </>}
    <TabBar />
  </div>;
}
