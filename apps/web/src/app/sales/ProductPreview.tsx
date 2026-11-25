"use client";
import { useState } from "react";
import type { Item } from "../inventory/data";
import styles from "../inventory/inventory.module.css";

export default function ProductPreview({ item, compact = false }: { item: Pick<Item, "nome" | "variante" | "sku" | "imagemUrl"> & { quantidade?: number | null }; compact?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <div className={styles.saleProduct}>
    <div className={styles.salePhoto}>
      {item.imagemUrl && failed !== item.imagemUrl
        // A imagem do catálogo já considera a variante e a alternativa do produto.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={item.imagemUrl} alt={item.nome} onError={() => setFailed(item.imagemUrl!)} />
        : <span role="img" aria-label="Produto sem foto">Sem foto</span>}
    </div>
    <div className={styles.info}><strong>{item.nome}</strong><span>Tamanho: {item.variante}</span>
      {!compact && <><small>{item.sku || "Sem SKU"}</small><small>{item.quantidade === undefined ? "Estoque indisponível" : item.quantidade === null ? "Estoque não controlado" : `Estoque: ${item.quantidade}`}</small></>}</div>
  </div>;
}
