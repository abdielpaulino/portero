"use client";
import { useId } from "react";
import { formatMoney, type OnlineOrder, type Summary } from "../sales/data";
import { chartMoney, chartPercentage, dailyCommercialSeries } from "./commercial-chart";
import styles from "./commercialChart.module.css";

export default function DailyCommercialChart({ period, external, orders, onlineLoaded, onlinePartial, externalEnabled, onlineEnabled, page }: {
  period: string; external: Summary | null; orders: OnlineOrder[]; onlineLoaded: boolean; onlinePartial: boolean; externalEnabled: boolean; onlineEnabled: boolean; page: number;
}) {
  const id = useId(), externalRows = externalEnabled ? external?.diario : undefined;
  const { series, incompletos } = dailyCommercialSeries(period, externalRows, onlineEnabled && onlineLoaded ? orders : undefined);
  return <section className={styles.container} aria-label="Valor comercial diário">
    <h3>Valor comercial por dia</h3>
    <p>Período {period} · horário de Brasília · sem frete. Não representa valor recebido.</p>
    <details><summary>Critérios dos valores</summary><p>Vendas externas confirmadas pela data informada da venda; pedidos online não cancelados pela criação, incluindo pagamentos pendentes. Fuso: America/Sao_Paulo.</p></details>
    <p>Externas: {externalRows !== undefined ? "todos os registros locais do período" : "série indisponível ou desativada"}.</p>
    <p>Online: {onlineLoaded ? `páginas 1 a ${page}; ${onlinePartial ? "valores parciais" : "consulta concluída"}` : "série indisponível ou desativada"}.</p>
    {onlineLoaded && onlinePartial && <p>Zeros online significam ausência de valor nas páginas consultadas, sem comprovar ausência de pedidos no dia.</p>}
    {incompletos > 0 && <p role="status">{incompletos} pedido(s) com dados incompletos excluídos dos valores; a série online é parcial.</p>}
    {!series.length && <p>Sem valores comerciais conhecidos nos registros consultados.</p>}
    {series.map(group => {
      const maximum = group.dias.reduce((max, point) => [point.externas, point.online].reduce<bigint>((value, amount) => amount !== null && amount > value ? amount : value, max), BigInt(0));
      const x = (index: number) => 32 + index * 560 / Math.max(1, group.dias.length - 1), y = (amount: bigint) => 160 - chartPercentage(amount, maximum) * 1.3;
      return <figure className={styles.figure} key={group.moeda}>
        <figcaption id={`${id}-${group.moeda}`}>Valor comercial diário · {group.moeda}</figcaption>
        <div className={styles.legend}><span className={styles.externalLabel}>Vendas externas confirmadas</span><span className={styles.onlineLabel}>Valor dos pedidos online</span></div>
        <p>Escala desta moeda: 0 a {formatMoney(chartMoney(maximum), group.moeda)}.</p>
        <svg viewBox="0 0 624 194" role="img" aria-labelledby={`${id}-${group.moeda}`}>
          <path d="M32 20V160H592" className={styles.axis} />
          {(["externas", "online"] as const).map(origin => <g key={origin}>
            {group.dias.some(point => point[origin] !== null) && <polyline className={origin === "externas" ? styles.external : styles.online}
              points={group.dias.map((point, index) => `${x(index)},${y(point[origin] ?? BigInt(0))}`).join(" ")} />}
            {group.dias.map((point, index) => point[origin] === null ? null : <circle key={point.dia} cx={x(index)} cy={y(point[origin]!)} r="2.8" fill={origin === "externas" ? "var(--purple)" : "#2563eb"}>
              <title>{point.dia} · {origin === "externas" ? "Vendas externas confirmadas" : "Valor dos pedidos online"}: {formatMoney(chartMoney(point[origin]!), group.moeda)}{origin === "online" && (onlinePartial || incompletos) ? " (parcial)" : ""}</title>
            </circle>)}
          </g>)}
          {group.dias.filter((_, index) => index % 5 === 0 || index === group.dias.length - 1).map(point => <text key={point.dia} x={x(group.dias.indexOf(point))} y="183" textAnchor="middle" className={styles.tick}>{point.dia.slice(8)}</text>)}
        </svg>
        <details><summary>Valores por dia em {group.moeda}</summary><div className={styles.tableWrap}><table>
          <thead><tr><th>Dia</th><th>Externas confirmadas</th><th>Valor dos pedidos online</th></tr></thead>
          <tbody>{group.dias.map(point => <tr key={point.dia}><td>{point.dia.slice(8)}/{point.dia.slice(5, 7)}</td>
            <td>{point.externas === null ? "Indisponível" : formatMoney(chartMoney(point.externas), group.moeda)}</td>
            <td>{point.online === null ? "Indisponível" : `${formatMoney(chartMoney(point.online), group.moeda)}${onlinePartial || incompletos ? " (parcial)" : ""}`}</td></tr>)}</tbody>
        </table></div></details>
      </figure>;
    })}
  </section>;
}
