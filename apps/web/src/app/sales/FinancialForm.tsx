"use client";
import { useState } from "react";
import { CommercialError, fetchSale, formatMoney, type ExternalSale } from "./data";
import { clearSavedRequest, correctionKey, readSavedRequest, savePending, usePending } from "./pending";
import type { Session } from "../auth/session";
import MoneyField from "./MoneyField";
import { localDateInput, PAYMENT_METHODS, splitPaymentMethod, validateFinancialForm } from "./form";
import { userMessage } from "../components/presentation";
import { formatMoneyInput } from "./money";
import styles from "../inventory/inventory.module.css";

type FinancialDraft = { tipo: string; valor: string; formaPagamento: string; ocorridoEm: string };
export default function FinancialForm({ sale, session, onChange }: { sale: ExternalSale; session: Session; onChange: (sale: ExternalSale) => void }) {
  const [type, setType] = useState("recebimento"), [value, setValue] = useState(""), [method, setMethod] = useState(splitPaymentMethod(sale.formaPagamento).method);
  const [otherMethod, setOtherMethod] = useState(splitPaymentMethod(sale.formaPagamento).other);
  const [date, setDate] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempted, setAttempted] = useState(false), [activeKey, setActiveKey] = useState<string | null>(null);
  const storageKey = `portero:financeiro:${session.loja.id}:${session.usuarioId}:${sale.id}`;
  const pendingRequest = usePending(storageKey);
  const correction = correctionKey(pendingRequest), editing = correction !== null && correction === activeKey;
  const frozen = (!!pendingRequest && !editing) || (!pendingRequest && !!activeKey);
  const validation = validateFinancialForm({ tipo: type, valor: value, formaPagamento: method === "Outro" && otherMethod.trim() ? `Outro: ${otherMethod.trim()}` : method, ocorridoEm: date }, sale.moeda);
  const errors: Record<string, string> = attempted ? validation.errors : {};
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage(""); setFailed(false); setInvalid(false);
    try {
      const pending = window.localStorage.getItem(storageKey);
      let saved = pending ? readSavedRequest<FinancialDraft>(pending) : null;
      if (activeKey && saved?.key !== activeKey) throw new Error("A solicitação salva mudou. Consulte a venda antes de continuar.");
      if (!saved || saved.correcting) {
        if (saved?.correcting && saved.key !== activeKey) throw new Error("Retome a correção do movimento salvo.");
        setAttempted(true);
        if (!validation.body) return;
        saved = { key: saved?.key ?? crypto.randomUUID(), body: validation.body };
        savePending(storageKey, JSON.stringify(saved));
      }
      setActiveKey(saved.key);
      const updated = await fetchSale(`/${sale.id}/financial-events`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": saved.key }, body: JSON.stringify(saved.body) });
      clearSavedRequest(storageKey, saved.key); setActiveKey(null); onChange(updated); setMessage("Movimento registrado.");
    } catch (error) { setFailed(true); setInvalid(error instanceof CommercialError && error.status === 400); setMessage(userMessage(error, "Não conseguimos confirmar o movimento. Confira os recebimentos desta venda antes de continuar.")); }
    finally { setBusy(false); }
  }
  function correctRequest() {
    if (!pendingRequest || busy || (!invalid && !correction)) return;
    try {
      const request = readSavedRequest<FinancialDraft>(pendingRequest), body = request.body;
      if (activeKey && request.key !== activeKey) throw new Error("A solicitação salva mudou. Consulte a venda antes de continuar.");
      savePending(storageKey, JSON.stringify({ ...request, correcting: true }));
      setActiveKey(request.key); setType(body.tipo); setValue(formatMoneyInput(String(body.valor ?? "")));
      const restoredMethod = splitPaymentMethod(body.formaPagamento); setMethod(restoredMethod.method); setOtherMethod(restoredMethod.other); setDate(localDateInput(body.ocorridoEm));
      setInvalid(false); setMessage(""); setFailed(false); setAttempted(true);
    } catch (failure) { setFailed(true); setMessage(failure instanceof Error ? failure.message : "Correção indisponível."); }
  }
  return <section className={styles.financialForm}>
    <h3>Recebimentos e estornos</h3>
    <p>Recebido: {formatMoney(sale.valorRecebido, sale.moeda)} · Estornado: {formatMoney(sale.valorEstornado, sale.moeda)}</p>
    {(pendingRequest || activeKey) && <p role="alert">{correction ? "Há um movimento em correção. Continue este registro antes de começar outro." : "Há um movimento sem confirmação. Confira os recebimentos antes de recuperar o mesmo registro."}</p>}
    {message && <p role={failed ? "alert" : "status"}>{userMessage(message)}</p>}
    <details open={!!pendingRequest || !!activeKey || attempted}><summary>Registrar recebimento ou estorno</summary>
    <form onSubmit={send} className={styles.salesForm} aria-busy={busy} noValidate>
      <fieldset disabled={busy || frozen}>
      <legend>Registrar movimento</legend><div className={styles.formGrid}>
      <label>Movimento <select value={type} onChange={e => setType(e.target.value)} disabled={busy}><option value="recebimento">Recebimento</option><option value="estorno">Estorno</option></select></label>{" "}
      <MoneyField label="Valor" currency={sale.moeda} value={value} onChange={setValue} error={errors.valor} />
      <label>Forma de pagamento <select required value={method} aria-invalid={!!errors.formaPagamento} onChange={e => setMethod(e.target.value)} disabled={busy}><option value="">Selecione</option>{PAYMENT_METHODS.map(value => <option key={value}>{value}</option>)}</select>
        {errors.formaPagamento && <small className={styles.fieldError} role="alert">{errors.formaPagamento}</small>}</label>
      {method === "Outro" && <label>Qual forma de pagamento? <input value={otherMethod} maxLength={73} onChange={e => setOtherMethod(e.target.value)} /></label>}
      <label>Data <input required type="datetime-local" value={date} aria-invalid={!!errors.ocorridoEm} onChange={e => setDate(e.target.value)} disabled={busy} />
        {errors.ocorridoEm && <small className={styles.fieldError} role="alert">{errors.ocorridoEm}</small>}</label>
      </div>
      </fieldset>
      <button className={styles.primaryButton} disabled={busy || (!pendingRequest && !!activeKey) || (!!correction && !editing)} type="submit" formNoValidate={frozen}>{busy ? "Registrando..." : editing ? "Confirmar correção" : pendingRequest ? "Recuperar mesmo movimento" : "Registrar movimento"}</button>
    </form>
    {!pendingRequest && activeKey && <p role="alert">A solicitação salva mudou. Consulte a venda antes de continuar.</p>}
    {correction && !editing && <button className={styles.secondaryButton} type="button" disabled={busy} onClick={correctRequest}>Retomar correção do movimento</button>}
    {invalid && <button className={styles.secondaryButton} type="button" disabled={busy} onClick={correctRequest}>Corrigir dados do movimento</button>}
    </details>
  </section>;
}
