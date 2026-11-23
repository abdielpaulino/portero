"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import styles from "../inventory/inventory.module.css";
import historyStyles from "./history.module.css";
import { carregarHistorico, statusLabel, type StockHistoryItem } from "./data";
import RecoverDecrease from "./RecoverDecrease";

export default function HistoryPage() {
  const [items, setItems] = useState<StockHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [failedPage, setFailedPage] = useState(1);

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
      <p className={styles.subtitle}>Movimentações de estoque; baixas antigas não comprovam vendas pagas.</p>
      <Link href="/inventory">Voltar ao inventário</Link>
      <Link href="/sales">Vendas externas e histórico financeiro</Link>
    </div>
    <div className={styles.list} aria-busy={loading}>
      <button type="button" className={styles.filterPill} disabled={loading} onClick={() => void carregar(1)}>Atualizar histórico</button>
      {loading && <p role="status">Carregando histórico...</p>}
      {erro && <div role="alert"><p>{erro}</p><Link href="/login">Entrar novamente</Link>{" "}
        <button type="button" className={styles.filterPill} disabled={loading} onClick={() => void carregar(failedPage)}>Tentar novamente</button></div>}
      {!loading && !erro && !items.length && <p className={styles.empty}>Nenhuma baixa registrada.</p>}
      {items.map((item) => <article key={item.id} className={historyStyles.card}>
        <strong>Baixa #{item.id} · {statusLabel(item.status)}</strong>
        <p>Variante {item.varianteId} · SKU: {item.sku || "—"}</p>
        <p>Produto {item.produtoId} · Quantidade: {item.quantidade}</p>
        <p>Usuário: {item.usuario?.nome || item.usuario?.email || "Não disponível"}</p>
        <small>Registro: {item.criadoEm ? new Date(item.criadoEm).toLocaleString("pt-BR") : "Data não disponível"}</small>
        {item.status === "registrada" && <RecoverDecrease item={item} onChange={() => void carregar(1)} />}
        {!["sincronizada", "rejeitada", "registrada"].includes(item.status) &&
          <p className={historyStyles.warning}>Solicite conferência da baixa. Não registre esta venda novamente.</p>}
      </article>)}
      {!erro && nextPage !== null && <button type="button" className={styles.filterPill} disabled={loading}
        onClick={() => void carregar(nextPage)}>Carregar mais</button>}
    </div>
    <TabBar />
  </div>;
}
