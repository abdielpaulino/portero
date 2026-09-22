"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import TabBar from "../components/TabBar";
import styles from "./dashboard.module.css";

type StatusPedido = "completed" | "pending" | "paused";

interface PedidoRecente {
  id: string;
  numero: string;
  valor: number;
  itens: number;
  status: StatusPedido;
}

interface Movimentacao {
  dia: string;
  valor: number;
}

interface DashboardData {
  vendasDoMes: number;
  variacaoVendas: number;
  totalPedidos: number;
  alertaRupturaPercentual: number;
  movimentacoes: Movimentacao[];
  pedidosRecentes: PedidoRecente[];
}

const STATUS_LABEL: Record<StatusPedido, string> = {
  completed: "COMPLETED",
  pending: "PENDING",
  paused: "PAUSED",
};

function formatarMoeda(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  const carregouRef = useRef(false);

  const carregarDashboard = useCallback(async () => {
    const res = await fetch("/api/dashboard");

    if (!res.ok) {
      throw new Error(`API /api/dashboard respondeu ${res.status}`);
    }

    const json: DashboardData = await res.json();
    setData(json);
  }, []);

  useEffect(() => {
    if (carregouRef.current) return;
    carregouRef.current = true;

    (async () => {
      setLoading(true);
      setErro(false);
      try {
        await carregarDashboard();
      } catch (err) {
        console.error("Erro ao carregar dashboard:", err);
        setErro(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [carregarDashboard]);

  const maiorMovimentacao = data
    ? Math.max(...data.movimentacoes.map((m) => m.valor), 1)
    : 1;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Fluxo do estoque</h1>
          <p className={styles.subtitle}>Atualizado do Nuvemshop</p>
        </div>
        <span className={styles.syncBadge}>
          <span className={styles.syncDot} />
          Sincronizado
        </span>
      </div>

      {loading &&
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`${styles.card} ${styles.skeleton}`} />
        ))}

      {!loading && erro && (
        <p className={styles.empty}>Não foi possível carregar os dados.</p>
      )}

      {!loading && !erro && data && (
        <>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Vendas do mês</span>
              <div className={styles.statValueRow}>
                <span className={styles.statValue}>
                  {formatarMoeda(data.vendasDoMes)}
                </span>
                <span
                  className={styles.statChange}
                  data-positive={data.variacaoVendas >= 0}
                >
                  {data.variacaoVendas >= 0 ? "+" : ""}
                  {data.variacaoVendas}%
                </span>
              </div>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statLabel}>Pedidos</span>
              <span className={styles.statValue}>{data.totalPedidos} Pedidos</span>
            </div>
          </div>

          <div className={styles.card}>
            <span className={styles.cardLabel}>Alertas de ruptura</span>
            <div className={styles.alertRow}>
              <span className={styles.alertValue}>
                {data.alertaRupturaPercentual}%
              </span>
              <span className={styles.alertBadge}>CRÍTICO</span>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeaderRow}>
              <span className={styles.cardLabel}>Movimentações</span>
              <span className={styles.cardHint}>Últimos 7 dias</span>
            </div>
            <div className={styles.chart}>
              {data.movimentacoes.map((m, i) => (
                <div key={i} className={styles.chartBarWrapper}>
                  <div
                    className={styles.chartBar}
                    style={{ height: `${(m.valor / maiorMovimentacao) * 100}%` }}
                  />
                  <span className={styles.chartLabel}>{m.dia}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <span className={styles.cardLabel}>Pedidos recentes</span>
            <div className={styles.orderList}>
              {data.pedidosRecentes.map((pedido) => (
                <div key={pedido.id} className={styles.orderRow}>
                  <div className={styles.orderInfo}>
                    <span className={styles.orderNumber}>
                      Pedido {pedido.numero}
                    </span>
                    <span className={styles.orderMeta}>
                      {formatarMoeda(pedido.valor)} · {pedido.itens}{" "}
                      {pedido.itens === 1 ? "item" : "itens"}
                    </span>
                  </div>
                  <span className={styles.statusBadge} data-status={pedido.status}>
                    {STATUS_LABEL[pedido.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <TabBar />
    </div>
  );
}
