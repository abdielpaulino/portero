"use client";
import { useRef, useState } from "react";
import type { Session } from "../auth/session";
import type { StockHistoryItem } from "./data";
import { usePending, savePending, clearPending } from "../sales/pending";

type Review = { id: number; conclusao: string; quantidadeComprovada: number | null; evidenciaReferencia: string; justificativa: string; responsavel: string; criadoEm: string };
export default function Conference({ item, session, onChange }: { item: StockHistoryItem; session: Session; onChange: () => void }) {
  const [open, setOpen] = useState(false), [reviews, setReviews] = useState<Review[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [conclusion, setConclusion] = useState("inconclusiva"), [quantity, setQuantity] = useState(String(item.quantidade));
  const [kind, setKind] = useState("registro_movimentacao"), [reference, setReference] = useState(""), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const guard = useRef(false), storageKey = `portero:conferencia:${session.loja.id}:${session.usuarioId}:${item.id}`, pending = usePending(storageKey);
  const eligible = ["incerta", "em_processamento", "pendente"].includes(item.status);
  async function load() {
    setError("");
    try {
      const response = await fetch(`/api/inventory/stock-decreases/${item.id}/reviews`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json(); if (!response.ok || !Array.isArray(data.items)) throw new Error(data.message ?? "Histórico de conferências inválido.");
      setReviews(data.items); setOpen(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível consultar conferências."); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (guard.current) return; guard.current = true; setBusy(true); setError("");
    try {
      const saved = pending ? JSON.parse(pending) : { key: crypto.randomUUID(), body: { conclusao: conclusion, quantidadeComprovada: conclusion === "inconclusiva" ? null : Number(quantity),
        evidenciaTipo: kind, evidenciaReferencia: reference, justificativa: reason, confirmoEvidencia: confirmed } };
      if (!pending) savePending(storageKey, JSON.stringify(saved));
      const response = await fetch(`/api/inventory/stock-decreases/${item.id}/reviews`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Idempotency-Key": saved.key }, body: JSON.stringify(saved.body) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 400) clearPending(storageKey); throw new Error(data.message ?? "Conferência não confirmada."); }
      if (!Number.isInteger(data.id) || typeof data.status !== "string") throw new Error("Resposta não confirmada; recupere a mesma conferência.");
      clearPending(storageKey); await load(); onChange();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Conferência não confirmada. Preserve a mesma chave."); }
    finally { guard.current = false; setBusy(false); }
  }
  return <div>
    <button type="button" disabled={busy} onClick={() => void load()}>Conferências da baixa</button>
    {open && <><p>Até 50 registros recentes. Esta conferência não envia baixa nem repõe estoque.</p>
      {reviews.map(review => <section key={review.id}><strong>{review.conclusao} · quantidade comprovada: {review.quantidadeComprovada ?? "indeterminada"}</strong>
        <p>{review.evidenciaReferencia}: {review.justificativa}</p><small>{review.responsavel} · {new Date(review.criadoEm).toLocaleString("pt-BR")}</small></section>)}
      {(eligible || pending) && <form method="post" onSubmit={submit}>
        {pending && <p role="status">Há uma conferência sem resposta confirmada. Reenviar mantém a mesma chave e os mesmos dados.</p>}
        <fieldset disabled={busy || !!pending}><legend>Registrar conferência administrativa</legend>
          <label>Conclusão<select value={conclusion} onChange={event => setConclusion(event.target.value)}><option value="inconclusiva">Inconclusiva — manter bloqueio</option><option value="integral">Aplicação integral comprovada</option><option value="nao_aplicada">Não aplicação comprovada</option><option value="parcial">Aplicação parcial comprovada</option></select></label>
          {conclusion !== "inconclusiva" && <label>Quantidade comprovada<input type="number" min={0} max={item.quantidade} required value={quantity} onChange={event => setQuantity(event.target.value)} /></label>}
          <label>Evidência<select value={kind} onChange={event => setKind(event.target.value)}><option value="registro_movimentacao">Registro de movimentação</option><option value="documento_operacional">Documento operacional</option></select></label>
          <label>Referência do documento<input required minLength={8} maxLength={500} value={reference} onChange={event => setReference(event.target.value)} /></label>
          <label>Justificativa<textarea required minLength={20} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <label><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Conferi a evidência documental; não usei somente o saldo atual.</label>
        </fieldset>
        <p>Não inclua senhas, tokens ou dados de consumidores. A conferência é registrada com seu usuário. Aplicação parcial não envia o restante automaticamente.</p>
        <button type="submit" disabled={busy}>{busy ? "Registrando..." : pending ? "Recuperar a mesma conferência" : "Registrar conferência"}</button>
      </form>}</>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
