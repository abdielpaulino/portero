"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import TabBar from "../components/TabBar";
import styles from "./inventory.module.css";
import { carregarInventario, filtrarItens, quantidadeLabel, precoLabel, type Item, type Filtro } from "./data";

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [erro, setErro] = useState("");
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [failedPage, setFailedPage] = useState(1);
  const carregarItens = useCallback(async (page: number) => {
    setLoading(true);
    setErro("");
    try {
      const data = await carregarInventario(page);
      setItems((current) => page === 1 ? data.items
        : [...new Map([...current, ...data.items].map((item) => [item.id, item])).values()]);
      setNextPage(data.nextPage);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o inventário. Tente novamente.");
      setFailedPage(page);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void carregarInventario(1, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setItems(data.items);
      setNextPage(data.nextPage);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Não foi possível carregar o inventário. Tente novamente.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const itensFiltrados = filtrarItens(items, busca, filtro);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Inventário</h1>
        <p className={styles.subtitle}>Produtos e variantes da loja</p>
      </div>

      <div className={styles.searchWrapper}>
        <svg
          className={styles.searchIcon}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Itens, variantes, SKUs..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <div className={styles.filters}>
        <button
          type="button"
          className={styles.filterPill}
          data-active={filtro === "todos"}
          onClick={() => setFiltro("todos")}
        >
          Todos
        </button>
        <button
          type="button"
          className={styles.filterPill}
          data-active={filtro === "ruptura"}
          onClick={() => setFiltro("ruptura")}
        >
          Ruptura
        </button>
        <button
          type="button"
          className={styles.filterPill}
          data-active={filtro === "estoque"}
          onClick={() => setFiltro("estoque")}
        >
          Com estoque
        </button>
      </div>

      <div className={styles.list} aria-busy={loading}>
        {nextPage !== null && <p className={styles.hint}>Busca e filtros nos itens carregados.</p>}
        {erro && (
          <div className={styles.empty} role="alert">
            <p>{erro}</p>
            <Link href="/login">Entrar novamente</Link>{" "}
            <button type="button" className={styles.filterPill} disabled={loading}
              onClick={() => void carregarItens(failedPage)}>Tentar novamente</button>
          </div>
        )}
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${styles.card} ${styles.skeleton}`} />
          ))}

        {!loading && !erro && itensFiltrados.length === 0 && (
          <p className={styles.empty}>Nenhum item encontrado.</p>
        )}

        {itensFiltrados.map((item) => (
            <div
              key={item.id}
              className={styles.card}
            >
              <div className={styles.thumb}>
                {item.imagemUrl ? (
                  <Image
                    src={item.imagemUrl}
                    alt={item.nome}
                    className={styles.thumbImg}
                    width={48}
                    height={48}
                    unoptimized
                  />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                )}
              </div>

              <div className={styles.info}>
                <span className={styles.itemName}>{item.nome}</span>
                <span className={styles.sku}>Variante: {item.variante}</span>
                <div className={styles.itemMeta}>
                  <span className={styles.sku}>SKU: {item.sku || "—"}</span>
                  <span
                    className={styles.qtyBadge}
                    data-ruptura={item.ruptura}
                  >
                    {quantidadeLabel(item)}
                  </span>
                  <span className={styles.status} data-ruptura={item.ruptura}>
                    {item.ruptura ? "Alerta Ruptura" : "Normal"}
                  </span>
                </div>
              </div>

              <span className={styles.price}>
                {precoLabel(item)}
              </span>
            </div>
          ))}
        {!loading && !erro && nextPage !== null && (
          <button type="button" className={styles.filterPill} onClick={() => void carregarItens(nextPage)}>
            Carregar mais
          </button>
        )}
      </div>

      <TabBar />
    </div>
  );
}
