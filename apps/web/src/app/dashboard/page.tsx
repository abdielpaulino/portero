"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import styles from "./dashboard.module.css";
import { carregarDashboard, type DashboardData } from "./data";
import { statusLabel } from "../history/data";
import CommercialDashboard from "./CommercialDashboard";
import { carregarSessao } from "../auth/session";
import { usePreferences } from "../settings/usePreferences";
import { userMessage } from "../components/presentation";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const { preferences, error: preferencesError } = usePreferences(settingsEnabled);
  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then(session => { if (!controller.signal.aborted) setSettingsEnabled(session?.configuracoesHabilitadas === true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void carregarDashboard(controller.signal, fetch, preferences?.limiteRuptura ?? 0).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar os indicadores.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, preferences?.limiteRuptura]);

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
  useEffect(() => {
    if (!preferences?.atualizacaoAutomatica) return;
    const timer = window.setInterval(() => { if (!loading && document.visibilityState === "visible") { setLoading(true); setRevision(current => current + 1); } }, preferences.intervaloSegundos * 1000);
    return () => window.clearInterval(timer);
  }, [preferences, loading]);
  return <div className={styles.container} aria-busy={loading}>
    {preferencesError && <p role="alert">O alerta de estoque pode estar desatualizado. <Link href="/settings">Conferir configurações</Link></p>}
    <div className={styles.header}>
      <div><h1 className={styles.title}>Minha loja</h1></div>
      <button className={styles.refreshButton} type="button" disabled={loading} onClick={atualizar}>Atualizar</button>
    </div>
    {loading && <p className={styles.notice} role="status">Carregando indicadores...</p>}
    {error && /sessão|acesso/i.test(error) && <p role="alert">{userMessage(error)} <Link href="/login">Entrar novamente</Link></p>}
    <CommercialDashboard revision={revision} inventory={data} stockLoading={loading} stockError={error} limit={preferences?.limiteRuptura ?? 0} />
    {data && <>
      <div className={styles.card}>
        <div className={styles.cardHeaderRow}><h2 className={styles.cardLabel}>Baixas de estoque</h2><Link href="/history">Ver histórico</Link></div>
        {data.recentes.some(item => !["sincronizada", "rejeitada", "conferida_parcial"].includes(item.status)) && <p role="alert">Há baixas recentes a conferir. <Link href="/history">Conferir baixas</Link></p>}
        <details><summary>Últimas baixas</summary>
        <div className={styles.orderList}>
          {!data.recentes.length && <p>Nenhuma baixa registrada.</p>}
          {data.recentes.map(item => <div key={item.id} className={styles.orderRow}>
            <div className={styles.orderInfo}>
              <span className={styles.orderNumber}>Baixa #{item.id} · {item.quantidade} un.</span>
              <span className={styles.orderMeta}>{item.sku || "Sem SKU"}</span>
              <small className={styles.orderMeta}>{new Date(item.criadoEm).toLocaleString("pt-BR")}</small>
            </div>
            <span className={styles.statusBadge} data-status={item.status}>{statusLabel(item.status)}</span>
          </div>)}
        </div>
        </details>
      </div>
    </>}
    <TabBar />
  </div>;
}
