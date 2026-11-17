"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

function isAuthenticated(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  const usuario = data.usuario as Record<string, unknown> | null;
  const loja = data.loja as Record<string, unknown> | null;
  return data.requiresStoreSelection === false && typeof usuario === "object" && usuario !== null
    && typeof usuario.id === "number" && Number.isSafeInteger(usuario.id) && usuario.id > 0
    && typeof loja === "object" && loja !== null && typeof loja.id === "number" && Number.isSafeInteger(loja.id) && loja.id > 0;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
          ? data.message : "Não foi possível entrar. Tente novamente.");
        return;
      }
      if (!isAuthenticated(data)) {
        setError("A API retornou uma resposta inválida. Tente novamente.");
        return;
      }
      setPassword("");
      router.replace("/inventory");
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Login</h1>
        <p className={styles.subtitle}>Acesse sua conta</p>
      </div>
      <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form} aria-busy={loading}>
          <div className={styles.field}>
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="username" placeholder="E-mail"
              value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Senha</label>
            <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Senha"
              value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} required />
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.button} disabled={loading}>{loading ? "Aguarde..." : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}
