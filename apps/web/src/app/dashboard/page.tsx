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
  sincronizado: boolean;
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

const DIAS_PLACEHOLDER = ["M", "T", "W", "T", "F", "S", "S"];

function formatarMoeda(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// ─────────────────────────────────────────────────────────
// DADOS TEMPORÁRIOS PARA APRESENTAÇÃO
// Descomente o bloco abaixo E a linha marcada dentro de
// carregarDashboard() para usar esses dados no lugar da API
// (que ainda não existe). Antes de subir pra produção, comente
// tudo de novo ou remova.
// ─────────────────────────────────────────────────────────
 const MOCK_DASHBOARD_DATA: DashboardData = {
   sincronizado: true, // Mude para 'false' para testar o skeleton em tudo
   vendasDoMes: 4850,
   variacaoVendas: 13,
   totalPedidos: 42,
   alertaRupturaPercentual: 10,
   movimentacoes: [
     { dia: "M", valor: 30 },
     { dia: "T", valor: 45 },
     { dia: "W", valor: 25 },
     { dia: "T", valor: 60 },
     { dia: "F", valor: 40 },
     { dia: "S", valor: 90 },
     { dia: "S", valor: 55 },
   ],
   pedidosRecentes: [
     { id: "1", numero: "#2048", valor: 128.5, itens: 2, status: "completed" },
     { id: "2", numero: "#2047", valor: 48.5, itens: 1, status: "pending" },
     { id: "3", numero: "#2046", valor: 352.5, itens: 3, status: "paused" },
   ],
 };

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  const carregouRef = useRef(false);

  const carregarDashboard = useCallback(async () => {
    // Descomente a linha abaixo (e o bloco MOCK_DASHBOARD_DATA acima)
    // para usar dados fake em vez de chamar a API na apresentação:
     { setData(MOCK_DASHBOARD_DATA); return; }

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

  useEffect(() => {
    if (!erro) return;

    const timer = setTimeout(async () => {
      try {
        await carregarDashboard();
        setErro(false);
      } catch (err) {
        console.error("Erro ao tentar sincronizar novamente:", err);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [erro, carregarDashboard]);

  const pronto = !loading && !erro && data !== null && data.sincronizado;

  const movimentacoes = pronto
    ? data!.movimentacoes
    : DIAS_PLACEHOLDER.map((dia) => ({ dia, valor: 1 }));

  const maiorMovimentacao = pronto
    ? Math.max(...data!.movimentacoes.map((m) => m.valor), 1)
    : 1;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Fluxo do estoque</h1>
          <p className={styles.subtitle}>Atualizado do Nuvemshop</p>
        </div>

        {pronto ? (
          <span className={styles.syncBadge}>
            <span className={styles.syncDot} />
            Sincronizado
          </span>
        ) : (
          <span
            className={`${styles.skeletonText} ${styles.skeletonBadge}`}
            aria-hidden="true"
          />
        )}
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Vendas do mês</span>
          <div className={styles.statValueRow}>
            {pronto ? (
              <>
                <span className={styles.statValue}>
                  {formatarMoeda(data!.vendasDoMes)}
                </span>
                <span
                  className={styles.statChange}
                  data-positive={data!.variacaoVendas >= 0}
                >
                  {data!.variacaoVendas >= 0 ? "+" : ""}
                  {data!.variacaoVendas}%
                </span>
              </>
            ) : (
              <span
                className={`${styles.statValue} ${styles.skeletonText}`}
                style={{ width: "100px" }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pedidos</span>
          {pronto ? (
            <span className={styles.statValue}>{data!.totalPedidos} Pedidos</span>
          ) : (
            <span
              className={`${styles.statValue} ${styles.skeletonText}`}
              style={{ width: "80px" }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      <div className={styles.card}>
        <span className={styles.cardLabel}>Alertas de ruptura</span>
        <div className={styles.alertRow}>
          {pronto ? (
            <>
              <span className={styles.alertValue}>
                {data!.alertaRupturaPercentual}%
              </span>
              <span className={styles.alertBadge}>CRÍTICO</span>
            </>
          ) : (
            <span
              className={`${styles.alertValue} ${styles.skeletonText}`}
              style={{ width: "60px" }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeaderRow}>
          <span className={styles.cardLabel}>Movimentações</span>
          <span className={styles.cardHint}>Últimos 7 dias</span>
        </div>
        <div className={styles.chart}>
          {movimentacoes.map((m, i) => (
            <div key={i} className={styles.chartBarWrapper}>
              <div
                className={`${styles.chartBar} ${!pronto ? styles.chartBarSkeleton : ""}`}
                style={{ height: pronto ? `${(m.valor / maiorMovimentacao) * 100}%` : "35%" }}
                aria-hidden={!pronto}
              />
              <span className={styles.chartLabel}>{m.dia}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <span className={styles.cardLabel}>Pedidos recentes</span>
        <div className={styles.orderList}>
          {pronto
            ? data!.pedidosRecentes.map((pedido) => (
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
              ))
            : [1, 2, 3].map((i) => (
                <div key={i} className={styles.orderRow}>
                  <div className={styles.orderInfo}>
                    <span
                      className={`${styles.orderNumber} ${styles.skeletonText}`}
                      style={{ width: "110px" }}
                      aria-hidden="true"
                    />
                    <span
                      className={`${styles.orderMeta} ${styles.skeletonText}`}
                      style={{ width: "150px" }}
                      aria-hidden="true"
                    />
                  </div>
                  <span
                    className={`${styles.statusBadge} ${styles.skeletonText}`}
                    style={{ width: "72px" }}
                    aria-hidden="true"
                  />
                </div>
              ))}
        </div>
      </div>

      <TabBar />
    </div>
  );
}