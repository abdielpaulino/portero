"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import styles from "./inventory.module.css";

interface Item {
  id: string;
  nome: string;
  sku: string;
  preco: number;
  quantidade: number;
  ruptura: boolean;
  imagemUrl?: string;
}

type Filtro = "todos" | "ruptura" | "estoque";

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const carregouRef = useRef(false);

  const carregarItens = useCallback(async () => {
    const res = await fetch("/api/inventory");

    if (!res.ok) {
      throw new Error(`API /api/inventory respondeu ${res.status}`);
    }

    const data: { items: Item[] } = await res.json();
    setItems(data.items);
  }, []);

  useEffect(() => {
    if (carregouRef.current) return;
    carregouRef.current = true;

    (async () => {
      setLoading(true);
      try {
        await carregarItens();
      } catch (err) {
        console.error("Erro ao carregar itens:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [carregarItens]);

  const itensFiltrados = items.filter((item) => {
    const buscaOk =
      item.nome.toLowerCase().includes(busca.toLowerCase()) ||
      item.sku.toLowerCase().includes(busca.toLowerCase());

    if (!buscaOk) return false;
    if (filtro === "ruptura") return item.ruptura;
    if (filtro === "estoque") return !item.ruptura && item.quantidade > 0;
    return true;
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Inventário</h1>
        <p className={styles.subtitle}>Ativos na loja</p>
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
          placeholder="Itens, SKUs..."
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

      <div className={styles.list}>
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${styles.card} ${styles.skeleton}`} />
          ))}

        {!loading && itensFiltrados.length === 0 && (
          <p className={styles.empty}>Nenhum item encontrado.</p>
        )}

        {!loading &&
          itensFiltrados.map((item) => (
            <div key={item.id} className={styles.card}>
              <div className={styles.thumb}>
                {item.imagemUrl ? (
                  <img
                    src={item.imagemUrl}
                    alt={item.nome}
                    className={styles.thumbImg}
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
                <div className={styles.itemMeta}>
                  <span className={styles.sku}>SKU: {item.sku}</span>
                  <span
                    className={styles.qtyBadge}
                    data-ruptura={item.ruptura}
                  >
                    {item.quantidade} UN
                  </span>
                  <span className={styles.status} data-ruptura={item.ruptura}>
                    {item.ruptura ? "Alerta Ruptura" : "Normal"}
                  </span>
                </div>
              </div>

              <span className={styles.price}>
                {item.preco.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </div>
          ))}
      </div>

      <nav className={styles.tabbar}>
        <button className={styles.tabItem} data-active="false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18M3 9h6" />
          </svg>
          Dashboard
        </button>
        <button className={styles.tabItem} data-active="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 8V21H3V8" />
            <path d="M1 3h22v5H1z" />
            <path d="M10 12h4" />
          </svg>
          Inventário
        </button>
        <button className={styles.tabItem} data-active="false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Configurações
        </button>
      </nav>
    </div>
  );
}
