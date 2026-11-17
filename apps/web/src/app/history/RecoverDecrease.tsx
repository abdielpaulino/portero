"use client";
import { useRef, useState } from "react";
import { comTravaDaBaixa, consultarBaixa, enviarBaixa, guardarBaixa, limparBaixa } from "../inventory/stock-decrease";
import type { StockHistoryItem } from "./data";
export default function RecoverDecrease({ item, onChange }: { item: StockHistoryItem; onChange: () => void }) {
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const submitting = useRef(false);
  async function act(cancel: boolean) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setMessage("");
    try {
      await comTravaDaBaixa(item, async () => {
        const record = await consultarBaixa(item.id);
        if (record.produtoId !== item.produtoId || record.varianteId !== item.varianteId || record.quantidade !== item.quantidade) throw new Error("Os dados não correspondem ao registro selecionado.");
        // A escolha explícita do ID no histórico recupera uma criação cuja resposta foi perdida.
        guardarBaixa(record, undefined, true);
        if (cancel) {
          const response = await fetch(`/api/inventory/stock-decreases/${item.id}/cancel`, { method: "POST", credentials: "same-origin",
            cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000) });
          const data = await response.json();
          if (!response.ok || data.baixaId !== item.id || data.statusSincronizacao !== "rejeitada") throw new Error("Cancelamento não confirmado. Consulte a mesma operação.");
          limparBaixa(record); setMessage("Registro cancelado, sem atualização remota.");
        } else {
          const result = await enviarBaixa(record); setMessage(result.message);
          if (result.kind === "success" || result.kind === "rejected") {
            try { limparBaixa(record); } catch {}
          }
          if (result.kind === "success") {
            try {
              const refresh = await fetch("/api/inventory?page=1", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30_000) });
              if (!refresh.ok) throw new Error();
            } catch { setMessage("Baixa confirmada. Atualize o inventário ao retornar."); }
          }
        }
        onChange();
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Resultado não confirmado. Consulte a mesma operação."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div>
    {!opened ? <button type="button" onClick={() => setOpened(true)}>Recuperar operação #{item.id}</button> : <>
      <p>Registro #{item.id}: variante {item.varianteId}, quantidade {item.quantidade}. Confirme que corresponde à sua venda.</p>
      <button type="button" disabled={busy} onClick={() => void act(false)}>{busy ? "Aguarde..." : "Executar este registro"}</button>{" "}
      <button type="button" disabled={busy} onClick={() => void act(true)}>Cancelar registro sem executar</button>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
