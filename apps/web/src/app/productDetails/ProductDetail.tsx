"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import TabBar from "../components/TabBar";
import StockDecrease from "../inventory/StockDecrease";
import { carregarCatalogo, precoLabel, quantidadeLabel } from "../inventory/data";
import { carregarSessao } from "../auth/session";
import { carregarProduto, type ProductDetail } from "./data";
import styles from "./productDetails.module.css";
import { usePreferences } from "../settings/usePreferences";

export default function ProductDetailView({ produtoId, varianteId }: { produtoId: string; varianteId?: string }) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selected, setSelected] = useState(varianteId ?? "");
  const [loading, setLoading] = useState(true), [enabled, setEnabled] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(0);
  const generation = useRef(0);
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const { preferences, error: preferencesError } = usePreferences(settingsEnabled);
  const load = useCallback((signal?: AbortSignal) => {
    const current = ++generation.current;
    return Promise.all([carregarProduto(produtoId, signal), carregarSessao(undefined, { signal })]).then(([data, session]) => {
      if (signal?.aborted || current !== generation.current) return;
      setProduct(data); setEnabled(session?.baixasHabilitadas === true);
      setSettingsEnabled(session?.configuracoesHabilitadas === true);
      setSelected(previous => previous || varianteId || data.items[0]?.varianteId || "");
    }).catch((failure: unknown) => {
      if (!signal?.aborted && current === generation.current) setError(failure instanceof Error ? failure.message : "Não foi possível carregar o produto.");
    }).finally(() => { if (!signal?.aborted && current === generation.current) setLoading(false); });
  }, [produtoId, varianteId]);
  const refresh = useCallback(() => {
    setLoading(true); setError(""); void load();
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    function onReturn() { if (!loading && busy === 0 && document.visibilityState === "visible") refresh(); }
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [loading, busy, refresh]);
  const onBusyChange = useCallback((value: boolean) => setBusy(current => current + (value ? 1 : -1)), []);
  const onSuccess = useCallback(() => {
    setNotice("Baixa confirmada."); refresh();
    void carregarCatalogo().catch(() => setNotice("Baixa confirmada. Atualize o inventário ao retornar."));
  }, [refresh]);
  const item = product?.items.find(variant => variant.varianteId === selected);
  useEffect(() => {
    if (!preferences?.atualizacaoAutomatica) return;
    const timer = window.setInterval(() => { if (!loading && busy === 0 && document.visibilityState === "visible") refresh(); }, preferences.intervaloSegundos * 1000);
    return () => window.clearInterval(timer);
  }, [preferences, loading, busy, refresh]);
  return <div className={styles.container} aria-busy={loading}>
    {preferencesError && <p role="alert">{preferencesError}</p>}
    {item && preferences && item.quantidade !== null && item.quantidade <= preferences.limiteRuptura && <p role="status">Variante no limite de ruptura ({preferences.limiteRuptura}).</p>}
    <div className={styles.topbar}>
      <Link className={styles.backBtn} href="/inventory">Voltar</Link>
      <button type="button" className={styles.stockLink} disabled={loading || busy > 0} onClick={refresh}>Atualizar estoque</button>
    </div>
    {loading && <p role="status">Carregando produto...</p>}
    {error && <div className={styles.section} role="alert"><p>{error}</p><Link href="/login">Entrar novamente</Link>{" "}
      <button type="button" disabled={loading || busy > 0} onClick={refresh}>Tentar novamente</button></div>}
    {product && <>
      <div className={styles.heroWrapper}><div className={styles.hero}>
        {item?.imagemUrl ? <Image src={item.imagemUrl} alt={product.nome} width={640} height={640} unoptimized className={styles.heroImg} /> : <p>Sem imagem</p>}
      </div></div>
      <div className={styles.infoWrapper}><h1 className={styles.itemName}>{product.nome}</h1>
        {item && <><p className={styles.sku}>SKU: {item.sku || "—"} · {quantidadeLabel(item)}</p><p className={styles.price}>{precoLabel(item)}</p></>}
      </div>
      <div className={styles.section}><h2 className={styles.sectionTitle}>Variações disponíveis</h2>
        <div className={styles.variations}>{product.items.map(variant => <button type="button" key={variant.id}
          className={styles.variationPill} data-active={variant.varianteId === selected} aria-pressed={variant.varianteId === selected}
          disabled={loading || busy > 0} onClick={() => { setSelected(variant.varianteId); setNotice(""); }}>{variant.variante}</button>)}</div>
        {!item && <p role="alert">Selecione uma variante disponível. A variante anterior pode ter sido removida.</p>}
      </div>
      {item && <div className={styles.section}>
        {item.quantidade !== null && item.quantidade < 0 && <p role="alert">Estoque negativo — solicite conferência.</p>}
        {!enabled && !loading && <p>Baixas desabilitadas nesta instalação.</p>}
        {notice && <p role="status">{notice}</p>}
        <StockDecrease key={item.id} item={item} disabled={loading || !!error || !enabled} onBusyChange={onBusyChange} onSuccess={onSuccess} />
      </div>}
    </>}
    <TabBar />
  </div>;
}
