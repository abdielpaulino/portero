"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabBar from "../components/TabBar";
import styles from "./settings.module.css";
import { carregarSessao, encerrarSessao, type Session } from "../auth/session";
import { loadPreferences, settingsRequest, type Preferences } from "./data";
import { userMessage } from "../components/presentation";

export default function SettingsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [rupturaQty, setRupturaQty] = useState("0");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const submitting = useRef(false);
  const [preferences, setPreferences] = useState<Preferences | null>(null), [recipient, setRecipient] = useState("");
  const [interval, setInterval] = useState("60"), [saving, setSaving] = useState(false), [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then(async (value) => {
      if (controller.signal.aborted) return;
      if (!value) { router.replace("/login"); router.refresh(); return; }
      setSession(value);
      if (value.configuracoesHabilitadas) {
        const data = await loadPreferences(controller.signal);
        if (!controller.signal.aborted) { setPreferences(data); setNotifications(data.notificacoesAtivas); setAutoSync(data.atualizacaoAutomatica);
          setRupturaQty(String(data.limiteRuptura)); setRecipient(data.emailNotificacoes ?? ""); setInterval(String(data.intervaloSegundos)); }
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Não foi possível carregar a conta.");
    });
    return () => controller.abort();
  }, [router]);

  async function save() {
    if (!preferences || saving) return; setSaving(true); setError(""); setNotice("");
    try {
      const data = await settingsRequest("", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limiteRuptura: Number(rupturaQty),
        notificacoesAtivas: notifications, emailNotificacoes: recipient.trim() || null, atualizacaoAutomatica: autoSync, intervaloSegundos: Number(interval), versao: preferences.versao }) });
      setPreferences(data); setNotice("Preferências salvas para esta loja.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Preferências não confirmadas."); }
    finally { setSaving(false); }
  }
  async function monitor() {
    if (saving) return; setSaving(true); setError(""); setNotice("");
    try {
      const result = await settingsRequest("/monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setNotice(`Verificação: ${result.abrangencia ?? "notificações desativadas"}. Alertas enviados: ${result.enviados ?? 0}; sem confirmação: ${result.incertos ?? 0}.`);
      setPreferences(await loadPreferences());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Monitoramento não confirmado."); }
    finally { setSaving(false); }
  }

  async function handleLogout() {
    if (submitting.current) return;
    submitting.current = true;
    setLeaving(true);
    setError("");
    try {
      await encerrarSessao();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Não foi possível sair. Tente novamente.");
    } finally {
      submitting.current = false;
      setLeaving(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Configurações</h1>
      </div>

      <div className={`${styles.card} ${styles.account}`}>
        <div className={styles.avatar}>NS</div>
        <div>
          <p className={styles.accountName}>Minha conta</p>
          <p className={styles.accountSubtitle}>Loja: {session?.loja.nomeLoja ?? "Carregando..."}</p>
        </div>
      </div>

      <div className={`${styles.card} ${styles.list}`}>
        {!preferences && <p className={styles.itemSubtitle} role={session ? undefined : "status"}>{!session ? "Carregando preferências..." : "Preferências indisponíveis. Solicite a habilitação à administração."}</p>}
        <div className={styles.item}>
          <span className={styles.itemIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </span>
          <div className={styles.itemText}>
            <span className={styles.itemTitle}>Notificações</span>
            <span className={styles.itemSubtitle}>Receba notificações pelo e-mail</span>
          </div>
          <button
            type="button"
            className={styles.switch}
            data-on={notifications}
            onClick={() => setNotifications((v) => !v)}
            aria-pressed={notifications}
            aria-label="Notificações"
            disabled={!preferences || saving}
          >
            <span className={styles.switchThumb} />
          </button>
        </div>

        <div className={styles.item}>
          <span className={styles.itemIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
          </span>
          <div className={styles.itemText}>
            <span className={styles.itemTitle}>Estoque baixo</span>
            <span className={styles.itemSubtitle}>Avisar até esta quantidade</span>
          </div>
          <input
            type="number"
            aria-label="Avisar até esta quantidade"
            min={0}
            disabled={!preferences || saving}
            className={styles.numberInput}
            value={rupturaQty}
            onChange={(e) => setRupturaQty(e.target.value)}
            onBlur={() => {
              if (rupturaQty === "") setRupturaQty("0");
            }}
          />
        </div>

        <div className={styles.item}>
          <span className={styles.itemIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </span>
          <div className={styles.itemText}>
            <span className={styles.itemTitle}>Atualizar estoque na tela</span>
          </div>
          <button
            type="button"
            className={styles.switch}
            data-on={autoSync}
            onClick={() => setAutoSync((v) => !v)}
            aria-pressed={autoSync}
            aria-label="Atualizar estoque na tela"
            disabled={!preferences || saving}
          >
            <span className={styles.switchThumb} />
          </button>
        </div>
        <div className={styles.item}><label>Destinatário<input type="email" value={recipient} onChange={event => setRecipient(event.target.value)} disabled={!preferences || saving} /></label></div>
        <div className={styles.item}><label>Intervalo da tela, em segundos<input type="number" min={60} max={3600} value={interval} onChange={event => setInterval(event.target.value)} disabled={!preferences || saving} /></label></div>
        <p className={styles.itemSubtitle}>O estoque é atualizado com a página aberta. Com a tela fechada, os alertas dependem do monitoramento diário.</p>
        {preferences && <><button type="button" disabled={saving} onClick={() => void save()}>Salvar preferências</button>
          <p>{preferences.envioConfigurado ? "Envio configurado. Confirme o recebimento no e-mail informado." : "Envio de notificações ainda não configurado ou habilitado."}</p>
          <button type="button" disabled={saving || !preferences.envioConfigurado || !preferences.notificacoesAtivas} onClick={() => void monitor()}>Verificar estoque agora</button>
          <p>Última verificação: {preferences.monitorEm ? new Date(preferences.monitorEm).toLocaleString("pt-BR") : "não executada"} · {preferences.monitorResultado === "completo" ? "concluída" : preferences.monitorResultado === "parcial" ? "parcial: há produtos a conferir" : "sem resultado confirmado"}</p>
          {preferences.alertas?.map(alert => <p key={alert.eventoId}>{alert.nome}: {({ pendente: "alerta pendente", em_envio: "envio em andamento", incerto: "envio sem confirmação", falhou: "falha no envio" } as Record<string, string>)[alert.estado] ?? "a conferir"}</p>)}
          <p>Envios sem confirmação não são repetidos automaticamente. Solicite conferência.</p></>}
      </div>

      {error && <p role="alert">{userMessage(error, "Não foi possível salvar as preferências. Confira os dados e tente novamente.")}</p>}
      {notice && <p role="status">{userMessage(notice)}</p>}
      <button type="button" className={styles.logout} onClick={handleLogout} disabled={leaving}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        {leaving ? "Saindo..." : "Sair"}
      </button>

      <TabBar />
    </div>
  );
}
