"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "../login/login.module.css";
import { userMessage } from "../components/presentation";

export default function ActivatePage() {
  const secret = useRef("");
  const [email, setEmail] = useState(""), [nome, setNome] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [done, setDone] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!secret.current) secret.current = new URLSearchParams(window.location.hash.slice(1)).get("codigo") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    void fetch("/api/auth/invitations/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
      signal: controller.signal, body: JSON.stringify({ codigo: secret.current }) }).then(async response => {
      const data = await response.json();
      if (!response.ok || typeof data.email !== "string") throw new Error(data.message ?? "Convite não confirmado.");
      if (!controller.signal.aborted) setEmail(data.email);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Convite não confirmado."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  async function activate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current || !email) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/invitations/activate", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: secret.current, nome, password, confirmation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Criação não confirmada.");
      setPassword(""); setConfirmation(""); secret.current = ""; setDone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Criação não confirmada. Tente entrar antes de repetir o convite."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className={styles.container}>
    <div className={styles.header}><h1 className={styles.title}>Ativar conta</h1></div>
    {done ? <p className={styles.success} role="status">Conta criada. <Link href="/login">Entrar no PORTERO</Link></p> : <form method="post" action="/api/auth/invitations/activate" className={`${styles.card} ${styles.form}`} onSubmit={activate} aria-busy={busy}>
      <label className={styles.field}>E-mail autorizado<input type="email" value={email} readOnly /></label>
      <label className={styles.field}>Nome<input value={nome} onChange={event => setNome(event.target.value)} required maxLength={100} autoComplete="name" /></label>
      <label className={styles.field}>Senha<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} required autoComplete="new-password" /></label>
      <label className={styles.field}>Confirmar senha<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={12} required autoComplete="new-password" /></label>
      <p className={styles.help}>Use pelo menos 12 caracteres. Não compartilhe o convite.</p>
      <button type="submit" className={styles.button} disabled={busy || !email}>{busy ? "Verificando..." : "Criar conta"}</button>
      <noscript>JavaScript é necessário para ativar a conta com segurança.</noscript>
    </form>}
    {error && <p className={styles.error} role="alert">{userMessage(error, "Não foi possível confirmar a conta. Tente entrar antes de pedir outro convite.")}</p>}
    {!done && !busy && error && <p className={styles.help}>Já criou sua senha? <Link href="/login">Tente entrar</Link>.</p>}
  </div>;
}
