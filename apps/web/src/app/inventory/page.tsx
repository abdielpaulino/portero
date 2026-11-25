"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import TabBar from "../components/TabBar";
import styles from "./inventory.module.css";
import { carregarCatalogo, filtrarItens, agruparProdutos, type Item, type Filtro } from "./data";
import ProductStockCard from "./ProductStockCard";
import { carregarSessao } from "../auth/session";
import { usePreferences } from "../settings/usePreferences";
import { countLabel, userMessage } from "../components/presentation";

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [page, setPage] = useState(1);
  const [erro, setErro] = useState("");
  const [baixasEmAndamento, setBaixasEmAndamento] = useState(0);
  const [aviso, setAviso] = useState("");
  const [baixasHabilitadas, setBaixasHabilitadas] = useState(false);
  const [vendasHabilitadas, setVendasHabilitadas] = useState<boolean | null>(null);
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const { preferences, error: preferencesError } = usePreferences(settingsEnabled);
  const refreshGeneration = useRef(0);

  const acompanharBaixa = useCallback((busy: boolean) => {
    setBaixasEmAndamento((current) => current + (busy ? 1 : -1));
    if (busy) setAviso("");
  }, []);

  const atualizarSaldo = useCallback((selected: Item) => {
    const generation = ++refreshGeneration.current;
    setAviso(`Baixa confirmada para ${selected.nome}, variante ${selected.variante}. Atualizando estoque...`);
    setLoading(true);
    void carregarCatalogo().then((catalogo) => {
      if (generation !== refreshGeneration.current) return;
      setItems(catalogo);
      setErro("");
      setAviso(`Baixa confirmada para ${selected.nome}, variante ${selected.variante}. Estoque atualizado.`);
    }).catch((error: unknown) => {
      if (generation !== refreshGeneration.current) return;
      setErro(error instanceof Error ? error.message : "A baixa foi confirmada, mas não foi possível atualizar o inventário.");
      setAviso("Baixa confirmada. O estoque exibido precisa ser atualizado.");
    }).finally(() => { if (generation === refreshGeneration.current) setLoading(false); });
  }, []);

  const carregarItens = useCallback((signal?: AbortSignal) => {
    const generation = ++refreshGeneration.current;
    return Promise.all([carregarCatalogo(signal), carregarSessao(undefined, { signal })]).then(([catalogo, session]) => {
      if (signal?.aborted || generation !== refreshGeneration.current) return;
      setBaixasHabilitadas(session?.baixasHabilitadas === true);
      setVendasHabilitadas(session?.vendasExternasHabilitadas === true);
      setSettingsEnabled(session?.configuracoesHabilitadas === true);
      setItems(catalogo);
    }).catch((error: unknown) => {
      if (signal?.aborted || generation !== refreshGeneration.current) return;
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o inventário. Tente novamente.");
    }).finally(() => {
      if (!signal?.aborted && generation === refreshGeneration.current) setLoading(false);
    });
  }, []);

  const atualizarConsulta = useCallback(() => {
    setLoading(true); setErro(""); void carregarItens();
  }, [carregarItens]);

  useEffect(() => {
    const controller = new AbortController();
    void carregarItens(controller.signal);
    return () => controller.abort();
  }, [carregarItens]);

  useEffect(() => {
    function atualizarAoRetornar() {
      if (!loading && baixasEmAndamento === 0 && document.visibilityState === "visible") atualizarConsulta();
    }
    window.addEventListener("focus", atualizarAoRetornar);
    document.addEventListener("visibilitychange", atualizarAoRetornar);
    return () => { window.removeEventListener("focus", atualizarAoRetornar); document.removeEventListener("visibilitychange", atualizarAoRetornar); };
  }, [loading, baixasEmAndamento, atualizarConsulta]);

  useEffect(() => {
    if (!preferences?.atualizacaoAutomatica) return;
    const timer = window.setInterval(() => { if (!loading && baixasEmAndamento === 0 && document.visibilityState === "visible") atualizarConsulta(); }, preferences.intervaloSegundos * 1000);
    return () => window.clearInterval(timer);
  }, [preferences, loading, baixasEmAndamento, atualizarConsulta]);
  const itensFiltrados = filtrarItens(items.map(item => ({ ...item, ruptura: item.quantidade !== null && item.quantidade <= (preferences?.limiteRuptura ?? 0) })), busca, filtro);
  const produtosFiltrados = agruparProdutos(itensFiltrados);
  const pageCount = Math.max(1, Math.ceil(produtosFiltrados.length / 30)), currentPage = Math.min(page, pageCount);
  const visibleProducts = produtosFiltrados.slice((currentPage - 1) * 30, currentPage * 30);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Inventário</h1>
        <p className={styles.subtitle}>Produtos e variantes da loja</p>
        {preferencesError && <p role="alert">{userMessage(preferencesError)}</p>}
        <div className={styles.actions}><Link href="/history">Histórico de baixas</Link></div>
        <p>Baixa simples: somente estoque. Para valores e pagamento, use Vendas.</p>
        {preferences && <p>Estoque baixo: saldo até {preferences.limiteRuptura}.</p>}
        {vendasHabilitadas === false && <p>Vendas externas indisponíveis no momento.</p>}
        <button type="button" className={styles.filterPill} disabled={loading || baixasEmAndamento > 0}
          onClick={atualizarConsulta}>Atualizar estoque</button>
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
          aria-label="Buscar produtos, variantes ou SKUs"
          className={styles.searchInput}
          placeholder="Itens, variantes, SKUs..."
          value={busca}
          disabled={loading || baixasEmAndamento > 0}
          onChange={(e) => { setBusca(e.target.value); setPage(1); }}
        />
      </div>

      <div className={styles.filters}>
        <button
          type="button"
          className={styles.filterPill}
          data-active={filtro === "todos"}
          disabled={loading || baixasEmAndamento > 0}
          onClick={() => { setFiltro("todos"); setPage(1); }}
        >
          Todos
        </button>
        <button
          type="button"
          className={styles.filterPill}
          data-active={filtro === "ruptura"}
          disabled={loading || baixasEmAndamento > 0}
          onClick={() => { setFiltro("ruptura"); setPage(1); }}
        >
          Ruptura
        </button>
        <button
          type="button"
          className={styles.filterPill}
          data-active={filtro === "estoque"}
          disabled={loading || baixasEmAndamento > 0}
          onClick={() => { setFiltro("estoque"); setPage(1); }}
        >
          Com estoque
        </button>
      </div>

      <div className={styles.list} aria-busy={loading}>
        {!loading && !baixasHabilitadas && <p className={styles.hint}>Baixas desabilitadas. Consulta e histórico disponíveis.</p>}
        {aviso && <p className={styles.hint} role="status">{aviso}</p>}
        {loading && <p className={styles.hint} role="status">Consultando todas as páginas do catálogo...</p>}
        {erro && (
          <div className={styles.empty} role="alert">
            <p>{userMessage(erro, "Não foi possível carregar o inventário.")}</p>
            <Link href="/login">Entrar novamente</Link>{" "}
            <button type="button" className={styles.filterPill} disabled={loading || baixasEmAndamento > 0}
              onClick={atualizarConsulta}>Tentar novamente</button>
          </div>
        )}
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${styles.card} ${styles.skeleton}`} />
          ))}

        {!loading && !erro && itensFiltrados.length === 0 && (
          <p className={styles.empty}>Nenhum item encontrado.</p>
        )}

        {visibleProducts.map(product => <ProductStockCard key={`${product.produtoId}:${busca}:${filtro}`}
          product={product} disabled={loading || !!erro} stockEnabled={baixasHabilitadas}
          onSuccess={atualizarSaldo} onBusyChange={acompanharBaixa} />)}

      </div>

      {!loading && !erro && itensFiltrados.length > 0 && <nav className={styles.pagination} aria-label="Páginas do catálogo">
        <p>Página {currentPage} de {pageCount} · {countLabel(produtosFiltrados.length, "produto")} · {countLabel(itensFiltrados.length, "variante")}</p>
        <button type="button" className={styles.filterPill} disabled={currentPage <= 1 || baixasEmAndamento > 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
        <button type="button" className={styles.filterPill} disabled={currentPage >= pageCount || baixasEmAndamento > 0} onClick={() => setPage(currentPage + 1)}>Próxima</button>
      </nav>}
      <TabBar />
    </div>
  );
}
