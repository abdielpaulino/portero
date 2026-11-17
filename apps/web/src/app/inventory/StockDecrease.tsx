"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Item } from "./data";
import { comTravaDaBaixa, criarBaixa, enviarBaixa, guardarBaixa, lerBaixaPendente, limparBaixa,
  quantidadeValida, registrarBaixa, type DecreaseResult, type PendingDecrease } from "./stock-decrease";

type Props = { item: Item; className?: string; disabled?: boolean; onSuccess: () => void; onBusyChange: (busy: boolean) => void };
export default function StockDecrease({ item, className, disabled, onSuccess, onBusyChange }: Props) {
  const inputId = useId();
  const [opened, setOpened] = useState(false), [quantidade, setQuantidade] = useState("1");
  const [operation, setOperation] = useState<PendingDecrease | null>(null);
  const [sending, setSending] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<DecreaseResult | null>(null);
  const submitting = useRef(false);
  async function open() {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await comTravaDaBaixa(item, async () => {
        const pending = lerBaixaPendente(item);
        setOperation(pending); setQuantidade(pending ? String(pending.quantidade) : "1");
        setResult(pending ? { kind: "pending", message: pending.baixaId === null
          ? "Criação sem ID confirmado. Recupere o registro pelo histórico."
          : `Operação #${pending.baixaId} pendente. Verifique esta mesma operação.` } : null);
        setError(""); setOpened(true);
      });
    } catch (error) { setError(error instanceof Error ? error.message : "Consulte o histórico antes de continuar."); }
    finally { submitting.current = false; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || disabled || result?.kind === "success" || result?.kind === "rejected") return;
    const quantity = operation?.quantidade ?? Number(quantidade);
    if (!quantidade.trim() || !quantidadeValida(quantity)) { setError("Informe uma quantidade inteira positiva."); return; }
    submitting.current = true; setSending(true); onBusyChange(true); setError("");
    try {
      await comTravaDaBaixa(item, async () => {
        let pending = operation ?? lerBaixaPendente(item);
        if (pending?.baixaId === null) { setOperation(pending); throw new Error("Criação não confirmada. Recupere a operação pelo histórico."); }
        if (!pending) {
          pending = criarBaixa(item, quantity);
          // A marca de criação deve sobreviver à perda da resposta, antes de existir um ID conhecido.
          guardarBaixa(pending); setOperation(pending);
          const registered = await registrarBaixa(pending);
          guardarBaixa(registered); pending = registered;
        }
        guardarBaixa(pending);
        setOperation(pending); setQuantidade(String(pending.quantidade)); setResult(null);
        const outcome = await enviarBaixa(pending); setResult(outcome);
        if (outcome.kind === "success") {
          try { limparBaixa(pending); } catch {}
          onSuccess();
        }
      });
    } catch (error) { setError(error instanceof Error ? error.message : "Operação não confirmada. Consulte o histórico."); }
    finally { submitting.current = false; setSending(false); onBusyChange(false); }
  }
  async function correctQuantity() {
    if (!operation || submitting.current) return;
    submitting.current = true;
    try {
      await comTravaDaBaixa(item, async () => { limparBaixa(operation); setOperation(null); setResult(null); setQuantidade(""); setError(""); });
    } catch { setError("Não foi possível liberar o registro recusado. Consulte o histórico."); }
    finally { submitting.current = false; }
  }
  return <div className={className}>
    {!opened && <button type="button" onClick={() => void open()} disabled={disabled} aria-expanded={false}
      aria-label={`Dar baixa em ${item.nome}, variante ${item.variante}`}>Dar baixa</button>}
    {opened && <form onSubmit={submit} noValidate aria-busy={sending} aria-label={`Dar baixa em ${item.nome}, variante ${item.variante}`}>
      {result?.kind !== "success" && <><label htmlFor={inputId}>Quantidade vendida</label>
        <input id={inputId} type="number" min="1" max="2147483647" step="1" value={quantidade}
          onChange={event => setQuantidade(event.target.value)} disabled={sending || disabled} readOnly={operation !== null} />
        {!operation && <p>Confirmar a baixa desta quantidade na variante {item.variante}?</p>}</>}
      {operation?.baixaId && <p>Operação #{operation.baixaId}</p>}
      {result && <p role={result.kind === "success" ? "status" : "alert"}>{result.message}</p>}
      <div>{result?.kind === "rejected" ? <button type="button" onClick={() => void correctQuantity()} disabled={sending || disabled}>Corrigir quantidade</button>
        : result?.kind !== "success" && <button type="submit" disabled={sending || disabled || operation?.baixaId === null}>
          {sending ? "Registrando..." : operation ? "Verificar operação" : "Confirmar baixa"}</button>}
        <button type="button" disabled={sending} onClick={() => setOpened(false)}>{operation ? "Fechar" : "Cancelar"}</button></div>
    </form>}
    {error && <p role="alert">{error}</p>}
    {(operation || error) && <Link href="/history">Recuperar pelo histórico</Link>}
  </div>;
}
