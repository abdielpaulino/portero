import type { OnlineOrder, Summary } from "../sales/data";

export type CommercialPoint = { dia: string; externas: bigint | null; online: bigint | null; incompletos: number };
export type CommercialSeries = { moeda: string; dias: CommercialPoint[] };
const dateFormat = new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export function commercialDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) return null;
  const parts = dateFormat.formatToParts(new Date(value));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value.padStart(type === "year" ? 4 : 2, "0")).join("-");
}
export function chartMoney(value: bigint) { return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`; }
function exactCents(value: string | null) { return value !== null && /^(0|[1-9]\d*)\.\d{2}$/.test(value) ? BigInt(value.replace(".", "")) : null; }
export function dailyCommercialSeries(period: string, external: Summary["diario"], online: OnlineOrder[] | undefined) {
  const days: string[] = [];
  if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    const cursor = new Date(`${period}-01T12:00:00Z`);
    while (cursor.toISOString().startsWith(period + "-")) { days.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  }
  const series = new Map<string, CommercialSeries>();
  function currency(code: string) {
    let group = series.get(code);
    if (!group) { group = { moeda: code, dias: days.map(dia => ({ dia, externas: external === undefined ? null : BigInt(0), online: online === undefined ? null : BigInt(0), incompletos: 0 })) }; series.set(code, group); }
    return group;
  }
  for (const row of external ?? []) {
    const amount = exactCents(row.valor); if (amount === null || !/^[A-Z]{3}$/.test(row.moeda) || !days.includes(row.dia)) continue;
    const point = currency(row.moeda).dias.find(point => point.dia === row.dia)!; point.externas = point.externas! + amount;
  }
  let incomplete = 0;
  const validDays = new Set<string>();
  for (const order of new Map((online ?? []).map(order => [`${order.storeId}:${order.id}`, order])).values()) {
    if (order.status === "cancelled") continue;
    const day = commercialDate(order.criadoEm); if (day && !days.includes(day)) continue;
    const amount = exactCents(order.valorProdutos), valid = day && order.moeda && /^[A-Z]{3}$/.test(order.moeda) && ["open", "closed"].includes(order.status) && amount !== null;
    if (!valid) incomplete++;
    if (!day || !order.moeda || !/^[A-Z]{3}$/.test(order.moeda)) continue;
    const point = currency(order.moeda).dias.find(point => point.dia === day)!;
    if (!valid) point.incompletos++;
    else { point.online = point.online! + amount!; validDays.add(`${order.moeda}:${day}`); }
  }
  for (const group of series.values()) for (const point of group.dias) {
    if (point.incompletos > 0 && !validDays.has(`${group.moeda}:${point.dia}`)) point.online = null;
  }
  return { series: [...series.values()].sort((a, b) => a.moeda.localeCompare(b.moeda)), incompletos: incomplete };
}
// Somente a proporção visual é convertida para Number; os valores permanecem exatos.
export function chartPercentage(value: bigint, maximum: bigint) { return maximum === BigInt(0) ? 0 : Number(value * BigInt(10000) / maximum) / 100; }
