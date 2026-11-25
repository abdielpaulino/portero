"use client";
import { useState } from "react";
import styles from "./dashboard.module.css";

export default function ProductPhoto({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={styles.productPhoto}>
    {src && failed !== src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(src)} />
      : <span role="img" aria-label={`${name}, sem foto`}>Sem foto</span>}
  </span>;
}
