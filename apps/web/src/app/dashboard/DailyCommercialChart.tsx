"use client";
import { useEffect, useId, useRef, useState } from "react";
import { formatMoney, type OnlineOrder, type Summary } from "../sales/data";
import { chartMoney, chartPercentage, dailyCommercialSeries } from "./commercial-chart";
import styles from "./commercialChart.module.css";

export default function DailyCommercialChart({ period, external, orders, onlineLoaded, onlinePartial, externalEnabled, onlineEnabled, currency }: {
  period: string; external: Summary | null; orders: OnlineOrder[]; onlineLoaded: boolean; onlinePartial: boolean; externalEnabled: boolean; onlineEnabled: boolean; page: number; currency?: string;
}) {
  const id = useId(), externalRows = externalEnabled ? external?.diario : undefined;
  const container = useRef<HTMLElement>(null), [width, setWidth] = useState(680);
  useEffect(() => {
    if (!container.current || !window.ResizeObserver) return;
    const observer = new window.ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width;
      if (measured > 0) setWidth(Math.max(240, Math.floor(measured)));
    });
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const { series, incompletos } = dailyCommercialSeries(period, externalRows, onlineEnabled && onlineLoaded ? orders : undefined);
  return <section className={styles.container} aria-label="Valor comercial diário" ref={container}>
    <h2>Vendas no período</h2>
    <p>Valor vendido por dia. Não representa valor recebido.</p>
    <p>Pedidos online podem incluir pagamentos pendentes.</p>
    {onlineLoaded && (onlinePartial || incompletos > 0) && <p role="alert">Pedidos online: valores parciais.</p>}
    {!series.filter(group => !currency || currency === group.moeda).length && <p>Sem valores disponíveis para o gráfico.</p>}
    {series.filter(group => !currency || currency === group.moeda).map(group => {
      const maximum = group.dias.reduce((max, point) => [point.externas, point.online].reduce<bigint>((value, amount) => amount !== null && amount > value ? amount : value, max), BigInt(0));
      const left = 86, right = width - 26;
      const x = (index: number) => left + index * (right - left) / Math.max(1, group.dias.length - 1), y = (amount: bigint) => 176 - chartPercentage(amount, maximum) * 1.5;
      const axisMoney = (value: bigint) => value < BigInt(100000) ? formatMoney(chartMoney(value), group.moeda)
        : `${group.moeda === "BRL" ? "R$" : group.moeda} ${new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value / BigInt(100))}`;
      function segments(origin: "externas" | "online") {
        const paths: string[][] = []; let current: string[] = [];
        group.dias.forEach((point, index) => {
          const value = point[origin];
          if (value === null) { if (current.length) paths.push(current); current = []; }
          else current.push(`${x(index)},${y(value)}`);
        });
        if (current.length) paths.push(current);
        return paths;
      }
      return <figure className={styles.figure} key={group.moeda}>
        <figcaption id={`${id}-${group.moeda}`}>Valor vendido por dia · {group.moeda}</figcaption>
        <div className={styles.legend}><span className={styles.externalLabel}>Vendas externas{externalRows === undefined ? " (indisponível)" : ""}</span><span className={styles.onlineLabel}>Pedidos online{!onlineLoaded ? " (indisponível)" : ""}</span></div>
        <svg viewBox={`0 0 ${width} 220`} role="img" aria-labelledby={`${id}-${group.moeda}`} aria-describedby={`${id}-${group.moeda}-description`}>
          <desc id={`${id}-${group.moeda}-description`}>Evolução diária em {group.moeda}. Linha roxa: vendas externas confirmadas. Linha azul tracejada: valor dos pedidos online não cancelados.</desc>
          <path d={`M${left} 26V176H${right}`} className={styles.axis} />
          {[BigInt(0), maximum / BigInt(2), maximum].filter((value, index, rows) => rows.indexOf(value) === index).map(value => <text key={String(value)} x={left - 8} y={y(value) + 4} textAnchor="end" className={styles.tick}>{axisMoney(value)}</text>)}
          {(["externas", "online"] as const).map(origin => <g key={origin}>
            {segments(origin).map((path, index) => <polyline key={index} className={origin === "externas" ? styles.external : styles.online} points={path.join(" ")} />)}
            {group.dias.map((point, index) => point[origin] === null ? null : <circle key={point.dia} cx={x(index)} cy={y(point[origin]!)} r="2.8" fill={origin === "externas" ? "var(--purple)" : "#2563eb"}>
              <title>{point.dia.slice(8)}/{point.dia.slice(5, 7)} · {origin === "externas" ? "Vendas externas" : "Pedidos online"}: {formatMoney(chartMoney(point[origin]!), group.moeda)}{origin === "online" && (onlinePartial || incompletos) ? " (parcial)" : ""}</title>
            </circle>)}
          </g>)}
          {group.dias.filter((_, index) => index % (width < 400 ? 10 : 5) === 0 || index === group.dias.length - 1).map(point => <text key={point.dia} x={x(group.dias.indexOf(point))} y="200" textAnchor="middle" className={styles.tick}>{point.dia.slice(8)}/{point.dia.slice(5, 7)}</text>)}
        </svg>
      </figure>;
    })}
  </section>;
}
