"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabBar from "../components/TabBar";
import styles from "./settings.module.css";
import { carregarSessao, encerrarSessao, type Session } from "../auth/session";

export default function SettingsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [rupturaQty, setRupturaQty] = useState("0");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void carregarSessao(undefined, { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      if (!value) { router.replace("/login"); router.refresh(); return; }
      setSession(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Não foi possível carregar a conta.");
    });
    return () => controller.abort();
  }, [router]);

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
        <p className={styles.subtitle}>Preferências da aplicação</p>
      </div>

      <div className={`${styles.card} ${styles.account}`}>
        <div className={styles.avatar}>NS</div>
        <div>
          <p className={styles.accountName}>Conta PORTERO{session ? ` #${session.usuarioId}` : ""}</p>
          <p className={styles.accountSubtitle}>Loja: {session?.loja.nomeLoja ?? "Carregando..."}</p>
        </div>
      </div>

      <div className={`${styles.card} ${styles.list}`}>
        <p className={styles.itemSubtitle}>Prévia: estas preferências ainda não são salvas.</p>
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
            <span className={styles.itemTitle}>Considerar ruptura</span>
            <span className={styles.itemSubtitle}>Alertar ruptura para a quantidade</span>
          </div>
          <input
            type="number"
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
            <span className={styles.itemTitle}>Sincronização automática</span>
          </div>
          <button
            type="button"
            className={styles.switch}
            data-on={autoSync}
            onClick={() => setAutoSync((v) => !v)}
            aria-pressed={autoSync}
            aria-label="Sincronização automática"
          >
            <span className={styles.switchThumb} />
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}
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
