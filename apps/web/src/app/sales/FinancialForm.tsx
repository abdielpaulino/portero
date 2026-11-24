"use client";
import { useState } from "react";
import { CommercialError, fetchSale, formatMoney, type ExternalSale } from "./data";
import { clearPending, savePending, usePending } from "./pending";
import type { Session } from "../auth/session";

export default function FinancialForm({ sale, session, onChange }: { sale: ExternalSale; session: Session; onChange: (sale: ExternalSale) => void }) {
  const [type, setType] = useState("recebimento"), [value, setValue] = useState(""), [method, setMethod] = useState(sale.formaPagamento);
  const [date, setDate] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const storageKey = `portero:financeiro:${session.loja.id}:${session.usuarioId}:${sale.id}`;
  const pendingRequest = usePending(storageKey);
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      let pending = window.localStorage.getItem(storageKey);
      if (!pending) {
        const body = { tipo: type, valor: value, formaPagamento: method, ocorridoEm: new Date(date).toISOString() };
        pending = JSON.stringify({ key: crypto.randomUUID(), body }); savePending(storageKey, pending);
      }
      const saved = JSON.parse(pending);
      const updated = await fetchSale(`/${sale.id}/financial-events`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": saved.key }, body: JSON.stringify(saved.body) });
      clearPending(storageKey); onChange(updated); setMessage("Movimento informado registrado. Nenhuma cobrança ou alteração de estoque foi realizada.");
    } catch (error) { setFailed(true); setInvalid(error instanceof CommercialError && error.status === 400); setMessage(`${error instanceof Error ? error.message : "Resposta perdida."} A mesma chave será preservada para recuperação.`); }
    finally { setBusy(false); }
  }
  return <div>
    <p>Recebido informado: {formatMoney(sale.valorRecebido, sale.moeda)} · Estornado informado: {formatMoney(sale.valorEstornado, sale.moeda)}</p>
    <form onSubmit={send}>
      <fieldset disabled={busy || !!pendingRequest}>
      <label>Movimento <select value={type} onChange={e => setType(e.target.value)} disabled={busy}><option value="recebimento">Recebimento</option><option value="estorno">Estorno</option></select></label>{" "}
      <label>Valor <input required value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={busy} /></label>{" "}
      <label>Forma <input required value={method} onChange={e => setMethod(e.target.value)} disabled={busy} /></label>{" "}
      <label>Data (fuso do navegador) <input required type="datetime-local" value={date} onChange={e => setDate(e.target.value)} disabled={busy} /></label>{" "}
      </fieldset>
      <button disabled={busy} type="submit" formNoValidate={!!pendingRequest}>Registrar ou recuperar mesmo movimento</button>
    </form>
    {pendingRequest && <p>Há uma solicitação salva. A recuperação usa seus dados originais e a mesma chave.</p>}
    {invalid && <button type="button" disabled={busy} onClick={() => { clearPending(storageKey); setInvalid(false); }}>Corrigir solicitação recusada como inválida</button>}
    {message && <p role={failed ? "alert" : "status"}>{message}</p>}
  </div>;
}
