"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./productDetails.module.css";

interface ProductDetail {
  id: string;
  nome: string;
  sku: string;
  preco: number;
  quantidade: number;
  imagemUrl?: string;
  variacoes: string[];
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [item, setItem] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [variacaoSelecionada, setVariacaoSelecionada] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState(0);
  const [salvando, setSalvando] = useState(false);

  const carregouRef = useRef(false);

  const carregarItem = useCallback(async () => {
    const res = await fetch(`/api/inventory/${params.id}`);

    if (!res.ok) {
      throw new Error(`API /api/inventory/${params.id} respondeu ${res.status}`);
    }

    const data: ProductDetail = await res.json();
    setItem(data);
    setVariacaoSelecionada(data.variacoes?.[0] ?? null);
  }, [params.id]);

  useEffect(() => {
    if (carregouRef.current) return;
    carregouRef.current = true;

    (async () => {
      setLoading(true);
      try {
        await carregarItem();
      } catch (err) {
        console.error("Erro ao carregar item:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [carregarItem]);

  const atualizarEstoque = useCallback(async () => {
    if (!item || ajuste === 0) return;

    setSalvando(true);
    try {
      const res = await fetch(`/api/inventory/${item.id}/stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: ajuste, variacao: variacaoSelecionada }),
      });

      if (!res.ok) {
        throw new Error(`API de estoque respondeu ${res.status}`);
      }

      const data: ProductDetail = await res.json();
      setItem(data);
      setAjuste(0);
    } catch (err) {
      console.error("Erro ao atualizar estoque:", err);
    } finally {
      setSalvando(false);
    }
  }, [item, ajuste, variacaoSelecionada]);

  return (
    <div className={styles.container}>
      <div className={styles.topbar}>
        <button type="button" className={styles.backBtn} onClick={() => router.back()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Voltar
        </button>

        <button
          type="button"
          className={styles.stockLink}
          onClick={atualizarEstoque}
          disabled={salvando || ajuste === 0}
        >
          {salvando ? "Salvando..." : "Atualização de estoque"}
        </button>
      </div>

      <div className={styles.heroWrapper}>
        {loading || !item ? (
          <div className={`${styles.hero} ${styles.heroSkeleton}`} />
        ) : item.imagemUrl ? (
          <div className={styles.hero}>
            <img src={item.imagemUrl} alt={item.nome} className={styles.heroImg} />
          </div>
        ) : (
          <div className={styles.hero}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {!loading && item && (
        <>
          <div className={styles.infoWrapper}>
            <h1 className={styles.itemName}>{item.nome}</h1>
            <p className={styles.sku}>SKU: {item.sku}</p>
            <p className={styles.price}>
              {item.preco.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </p>
          </div>

          {item.variacoes?.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Variações disponíveis</p>
              <div className={styles.variations}>
                {item.variacoes.map((variacao) => (
                  <button
                    key={variacao}
                    type="button"
                    className={styles.variationPill}
                    data-active={variacaoSelecionada === variacao}
                    onClick={() => setVariacaoSelecionada(variacao)}
                  >
                    {variacao}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Ajuste de estoque</p>
            <div className={styles.stockAdjust}>
              <button
                type="button"
                className={styles.stepBtn}
                onClick={() => setAjuste((v) => v - 1)}
                disabled={salvando}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <span className={styles.stepValue}>{ajuste}</span>

              <button
                type="button"
                className={styles.stepBtn}
                onClick={() => setAjuste((v) => v + 1)}
                disabled={salvando}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
