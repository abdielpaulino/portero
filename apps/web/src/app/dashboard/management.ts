import { decimal, onlineTotals, type DashboardSummary, type OnlineOrder } from "../sales/data";
import { commercialDate } from "./commercial-chart";

export function sumMoney(values: string[]): string | null {
  if (!values.every(decimal)) return null;
  const cents = values.reduce((sum, value) => sum + BigInt(value.replace(".", "")), BigInt(0));
  const absolute = cents < BigInt(0) ? -cents : cents;
  return `${cents < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
export function formatUnits(value: string | null) { return value === null ? "Indisponível" : BigInt(value).toLocaleString("pt-BR"); }
export function periodLabel(period: string) {
  return new Date(`${period}-01T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
}
export function dashboardFigures(external: DashboardSummary | null, orders: OnlineOrder[], onlineLoaded: boolean, currency: string, period: string) {
  const externalRows = external?.totais.filter(row => row.moeda === currency);
  const dated = orders.filter(order => commercialDate(order.criadoEm)?.startsWith(period + "-"));
  const totals = onlineTotals(dated), online = totals.find(row => row.moeda === currency);
  const unknownCurrency = totals.some(row => row.moeda === "Não informada");
  const unknownDates = orders.some(order => order.status !== "cancelled" && !commercialDate(order.criadoEm));
  const externalValue = externalRows ? sumMoney(externalRows.map(row => row.valorVendido)) : null;
  const onlineValue = !onlineLoaded || unknownDates && !online || unknownCurrency && !online || online && online.pedidos === online.incompletos ? null : online?.valor ?? "0.00";
  const known = [externalValue, onlineValue].filter((value): value is string => value !== null);
  const management = external?.gestao?.porMoeda.find(row => row.moeda === currency);
  const externalSales = externalRows ? externalRows.reduce((sum, row) => sum + row.vendas, 0) : null;
  const onlineOrders = onlineLoaded && (online || !unknownDates && !unknownCurrency) ? online?.pedidos ?? 0 : null;
  return {
    externalValue, onlineValue, sold: known.length ? sumMoney(known) : null,
    received: externalRows ? sumMoney(externalRows.map(row => row.recebidoLiquido)) : null,
    outstanding: external?.gestao ? management?.valorAReceber ?? "0.00" : null,
    units: external?.gestao ? management?.unidades ?? "0" : null,
    externalSales, onlineOrders,
    count: externalSales === null && onlineOrders === null ? null : (externalSales ?? 0) + (onlineOrders ?? 0),
    incomplete: unknownCurrency || unknownDates || totals.some(row => row.incompletos > 0),
    channels: externalRows?.filter(row => row.vendas > 0).map(row => ({ canal: row.canal, valor: row.valorVendido, vendas: row.vendas })) ?? null,
    ranking: external?.gestao?.produtosMaisVendidos.filter(row => row.moeda === currency) ?? null,
  };
}
