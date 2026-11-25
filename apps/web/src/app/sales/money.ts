export const MAX_MONEY = BigInt("999999999999999999");
const hundred = BigInt(100);

export function moneyCents(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * hundred + BigInt(fraction.padEnd(2, "0"));
}

export function moneyAmount(value: bigint): string {
  return `${value / hundred}.${String(value % hundred).padStart(2, "0")}`;
}

export function parseMoneyInput(value: string, currency: string): string | null {
  let raw = value.trim().replace(/\u00a0|\u202f/g, " ");
  if (currency === "BRL") raw = raw.replace(/^(?:R\$|BRL)\s*/i, "");
  else if (raw.startsWith(`${currency} `)) raw = raw.slice(currency.length).trimStart();
  if (raw.includes(",")) {
    if (!/^(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+),\d{1,2}$/.test(raw)) return null;
    raw = raw.replaceAll(".", "").replace(",", ".");
  } else if (/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(raw)) {
    raw = raw.replaceAll(".", "");
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  if (raw.length > 24) return null;
  const cents = moneyCents(raw);
  return cents <= MAX_MONEY ? moneyAmount(cents) : null;
}

export function formatMoneyInput(value: string): string {
  if (!/^\d+\.\d{2}$/.test(value)) return value;
  const [integer, fraction] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}

export function catalogMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) return "";
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return "";
  const normalized = parseMoneyInput(text, "BRL");
  return normalized ? formatMoneyInput(normalized) : "";
}
