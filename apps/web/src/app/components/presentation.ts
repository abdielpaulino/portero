export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function userMessage(value: unknown, fallback = "Não foi possível confirmar a operação. Confira o registro antes de continuar.") {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (/read_orders/i.test(message)) return "O acesso aos pedidos da loja online ainda não está liberado.";
  if (!message || /payload|uuid|idempoten|\bHTTP\b|\bAPI\b|\btoken\b|\bSQL\b|read_\w+|[0-9a-f]{8}-[0-9a-f]{4}-|\b[45]\d{2}\b|chave|requisi[çc][ãa]o/i.test(message)) return fallback;
  return message;
}

export function paymentLabel(status: string) {
  return ({ pendente: "Pendente", parcial: "Parcial", pago: "Pago", estornado: "Estornado", parcialmente_estornado: "Estorno parcial",
    pending: "Pendente", authorized: "Autorizado", partially_paid: "Parcial", paid: "Pago", refunded: "Estornado", voided: "Cancelado", abandoned: "Não concluído" } as Record<string, string>)[status] ?? "A conferir";
}
