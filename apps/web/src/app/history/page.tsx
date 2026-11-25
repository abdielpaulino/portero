"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import styles from "../inventory/inventory.module.css";
import historyStyles from "./history.module.css";
import { carregarHistorico, statusLabel, type StockHistoryItem } from "./data";
import RecoverDecrease from "./RecoverDecrease";
import Conference from "./Conference";
import { carregarSessao, type Session } from "../auth/session";
import { userMessage } from "../components/presentation";

export default function HistoryPage() {
  const [items, setItems] = useState<StockHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [failedPage, setFailedPage] = useState(1);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setSession(value); }).catch(() => {});
    return () => controller.abort();
  }, []);

  const carregar = useCallback(async (page: number) => {
    setLoading(true);
    setErro("");
    try {
      const data = await carregarHistorico(page);
      setItems((current) => page === 1 ? data.items : [...new Map([...current, ...data.items].map((item) => [item.id, item])).values()]);
      setNextPage(data.hasMore ? page + 1 : null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o histórico.");
      setFailedPage(page);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void carregarHistorico(1, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setItems(data.items);
      setNextPage(data.hasMore ? 2 : null);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Não foi possível carregar o histórico.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return <div className={styles.container}>
    <div className={styles.header}>
      <h1 className={styles.title}>Histórico de baixas</h1>
      <p className={styles.subtitle}>Movimentações de estoque</p>
      <div className={styles.actions}><Link href="/inventory">Voltar ao inventário</Link></div>
    </div>
    <div className={styles.list} aria-busy={loading}>
      <button type="button" className={styles.filterPill} disabled={loading} onClick={() => void carregar(1)}>Atualizar histórico</button>
      {loading && <p role="status">Carregando histórico...</p>}
      {erro && <div role="alert"><p>{userMessage(erro)}</p><Link href="/login">Entrar novamente</Link>{" "}
        <button type="button" className={styles.filterPill} disabled={loading} onClick={() => void carregar(failedPage)}>Tentar novamente</button></div>}
      {!loading && !erro && !items.length && <p className={styles.empty}>Nenhuma baixa registrada.</p>}
      {items.map((item) => <article key={item.id} className={historyStyles.card}>
        <div className={historyStyles.cardHeader}><strong>Baixa #{item.id}</strong><span className={historyStyles.badge} data-status={item.status}>{statusLabel(item.status)}</span></div>
        <p>SKU: {item.sku || "Não informado"} · Quantidade: {item.quantidade}</p>
        <Link href={`/productDetails/${item.produtoId}?varianteId=${item.varianteId}`}>Ver produto</Link>
        <p>Usuário: {item.usuario?.nome || item.usuario?.email || "Não disponível"}</p>
        <small>Registro: {item.criadoEm ? new Date(item.criadoEm).toLocaleString("pt-BR") : "Data não disponível"}</small>
        {item.status === "registrada" && <RecoverDecrease item={item} onChange={() => void carregar(1)} />}
        {session?.conferenciasHabilitadas && <Conference item={item} session={session} onChange={() => void carregar(1)} />}
        {item.status === "conferida_parcial" && <p>Aplicação parcial conferida. Nenhuma quantidade restante é enviada automaticamente.</p>}
        {!["sincronizada", "rejeitada", "registrada", "conferida_parcial"].includes(item.status) &&
          <p className={historyStyles.warning}>Solicite conferência da baixa. Não registre esta venda novamente.</p>}
      </article>)}
      {!erro && nextPage !== null && <button type="button" className={styles.filterPill} disabled={loading}
        onClick={() => void carregar(nextPage)}>Carregar mais</button>}
    </div>
    <TabBar />
  </div>;
}
