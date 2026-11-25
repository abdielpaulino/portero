"use client";
import Link from "next/link";
import { formatMoney } from "../sales/data";
import type { DashboardData } from "./data";
import { countLabel } from "../components/presentation";
import { chartPercentage } from "./commercial-chart";
import { dashboardFigures, formatUnits } from "./management";
import ProductPhoto from "./ProductPhoto";
import styles from "./dashboard.module.css";

type Figures = ReturnType<typeof dashboardFigures>;
export default function ManagementCharts({ figures, currency, inventory }: { figures: Figures; currency: string; inventory?: DashboardData | null }) {
  const maximum = figures.channels?.reduce((max, row) => { const value = BigInt(row.valor.replace(".", "")); return value > max ? value : max; }, BigInt(0)) ?? BigInt(0);
  return <div className={styles.secondaryCharts}>
    <section className={styles.card} aria-label="Vendas por canal"><h2>Vendas por canal</h2><p className={styles.scope}>Somente vendas externas · {currency}</p>
      {figures.channels === null ? <p>Dados indisponíveis.</p> : !figures.channels.length ? <p>Nenhuma venda externa no período.</p> : <ul className={styles.channelList}>
        {figures.channels.map(row => <li key={row.canal}><div className={styles.cardHeaderRow}><strong>{row.canal}</strong><span>{formatMoney(row.valor, currency)}</span></div>
          <div className={styles.barTrack} aria-hidden="true"><span style={{ width: `${chartPercentage(BigInt(row.valor.replace(".", "")), maximum)}%` }} /></div>
          <small>{countLabel(row.vendas, "venda")}</small></li>)}
      </ul>}
    </section>
    <section className={styles.card} aria-label="Produtos mais vendidos"><h2>Produtos mais vendidos</h2><p className={styles.scope}>Somente vendas externas · por unidades · {currency}</p>
      {figures.ranking === null ? <p>Ranking ainda não disponível.</p> : !figures.ranking.length ? <p>Nenhum produto vendido no período.</p> : <ol className={styles.ranking}>
        {figures.ranking.map(row => {
          const product = inventory?.catalogo.find(item => item.produtoId === row.produtoId && item.imagemUrl);
          return <li key={row.produtoId}><ProductPhoto src={product?.imagemUrl} name={row.nome} /><div><Link href={`/productDetails/${row.produtoId}`}>{row.nome}</Link><span>{formatUnits(row.unidades)} {row.unidades === "1" ? "unidade" : "unidades"}</span></div></li>;
        })}
      </ol>}
    </section>
  </div>;
}
