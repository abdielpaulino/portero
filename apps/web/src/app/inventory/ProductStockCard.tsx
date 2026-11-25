"use client";

import { useCallback, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { precoLabel, quantidadeLabel, type InventoryProduct, type Item } from "./data";
import StockDecrease from "./StockDecrease";
import styles from "./inventory.module.css";

type Props = { product: InventoryProduct; disabled: boolean; stockEnabled: boolean; onSuccess: (item: Item) => void; onBusyChange: (busy: boolean) => void };

export default function ProductStockCard({ product, disabled, stockEnabled, onSuccess, onBusyChange }: Props) {
  const selectId = useId();
  const [selected, setSelected] = useState(product.variantes[0]?.varianteId ?? "");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const item = product.variantes.find(variant => variant.varianteId === selected);
  const first = product.variantes[0];
  const trackBusy = useCallback((value: boolean) => {
    inFlight.current = value;
    setBusy(value);
    onBusyChange(value);
  }, [onBusyChange]);
  if (!first) return null;
  const href = `/productDetails/${product.produtoId}${item ? `?varianteId=${item.varianteId}` : ""}`;

  return <article className={`${styles.card} ${styles.productCard}`} data-product-id={product.produtoId}>
    <div className={styles.productHeading}>
      <Link className={styles.thumb} href={href} aria-label={`Ver detalhes de ${first.nome}${item ? `, variante ${item.variante}` : ""}`}>
        {item?.imagemUrl ? <Image src={item.imagemUrl} alt={first.nome} className={styles.thumbImg} width={48} height={48} unoptimized /> :
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>}
      </Link>
      <div className={styles.info}><Link className={styles.itemName} href={href}>{first.nome}</Link>
        <span className={styles.sku}>{product.variantes.length} {product.variantes.length === 1 ? "variante" : "variantes"}</span>
      </div>
      {item && <span className={styles.price}>{precoLabel(item)}</span>}
    </div>
    <div className={styles.productControls}>
      <label className={styles.variantField} htmlFor={selectId}>Tamanho / variante
        <select id={selectId} value={item ? selected : ""} disabled={disabled || busy} onChange={event => {
          if (!inFlight.current) setSelected(event.target.value);
        }}>
          {!item && <option value="">Selecione uma variante</option>}
          {product.variantes.map(variant => <option key={variant.varianteId} value={variant.varianteId}>{variant.variante}{variant.sku ? ` · ${variant.sku}` : ""}</option>)}
        </select>
      </label>
      {item ? <>
        <div className={styles.itemMeta}>
          <span className={styles.sku}>SKU: {item.sku || "—"}</span>
          <span className={styles.qtyBadge} data-ruptura={item.ruptura} data-uncontrolled={item.quantidade === null}>{quantidadeLabel(item)}</span>
          {item.quantidade !== null && item.quantidade >= 0 && <span className={styles.status} data-ruptura={item.ruptura}>
            {item.quantidade === 0 ? "Sem estoque" : item.ruptura ? "Em ruptura" : "Disponível"}
          </span>}
        </div>
        {item.quantidade !== null && item.quantidade < 0 && <p className={styles.stockWarning} role="alert">Estoque negativo — conferir.</p>}
        <StockDecrease key={`${item.produtoId}:${item.varianteId}`} item={item} className={styles.stockAction} expanded disabled={disabled || !stockEnabled}
          onSuccess={() => onSuccess(item)} onBusyChange={trackBusy} />
      </> : <p className={styles.stockWarning} role="alert">A variante selecionada não está mais disponível. Selecione outra para continuar.</p>}
    </div>
  </article>;
}
