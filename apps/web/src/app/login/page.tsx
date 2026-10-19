"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

type Loja = {
  id: number;
  nomeLoja: string;
};

type AuthenticatedResponse = {
  requiresStoreSelection: false;
  usuario: { id: number; nome: string; email: string };
  loja: Loja;
};

type StoreSelectionResponse = {
  requiresStoreSelection: true;
  lojas: Loja[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isLoja(value: unknown): value is Loja {
  return isRecord(value) && isId(value.id) && typeof value.nomeLoja === "string";
}

function isAuthenticated(value: unknown): value is AuthenticatedResponse {
  return (
    isRecord(value) &&
    value.requiresStoreSelection === false &&
    isRecord(value.usuario) &&
    isId(value.usuario.id) &&
    typeof value.usuario.nome === "string" &&
    typeof value.usuario.email === "string" &&
    isLoja(value.loja)
  );
}

function needsStoreSelection(value: unknown): value is StoreSelectionResponse {
  return (
    isRecord(value) &&
    value.requiresStoreSelection === true &&
    Array.isArray(value.lojas) &&
    value.lojas.length > 0 &&
    value.lojas.every(isLoja)
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [selectionExpired, setSelectionExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectingStore = lojas.length > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || selectionExpired) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        selectingStore ? "/api/auth/select-store" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(
            selectingStore ? { lojaId: Number(selectedStore) } : { email, password },
          ),
        },
      );
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (selectingStore && response.status === 401) {
          setSelectionExpired(true);
          setError("Sua sessão de seleção expirou. Volte para o login.");
        } else {
          setError(
            isRecord(data) && typeof data.message === "string"
              ? data.message
              : "Não foi possível entrar. Tente novamente.",
          );
        }
        return;
      }

      if (isAuthenticated(data)) {
        setPassword("");
        router.replace("/dashboard");
        return;
      }

      if (!selectingStore && needsStoreSelection(data)) {
        setPassword("");
        setLojas(data.lojas);
        setSelectedStore(String(data.lojas[0].id));
        return;
      }

      setError("A API retornou uma resposta inválida. Tente novamente.");
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setLojas([]);
    setSelectedStore("");
    setSelectionExpired(false);
    setPassword("");
    setError("");
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{selectingStore ? "Escolha uma loja" : "Login"}</h1>
        <p className={styles.subtitle}>
          {selectingStore ? "Selecione a loja que deseja acessar" : "Acesse sua conta"}
        </p>
      </div>
      <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form} aria-busy={loading}>
          {selectingStore ? (
            <div className={styles.field}>
              <label htmlFor="loja">Loja</label>
              <select
                id="loja"
                value={selectedStore}
                onChange={(event) => setSelectedStore(event.target.value)}
                disabled={loading || selectionExpired}
                required
              >
                {lojas.map((loja) => (
                  <option key={loja.id} value={loja.id}>
                    {loja.nomeLoja}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="E-mail"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={loading}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="password">Senha</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button
            type="submit"
            className={styles.button}
            disabled={loading || selectionExpired}
          >
            {loading ? "Aguarde..." : selectingStore ? "Continuar" : "Entrar"}
          </button>
          {selectingStore && (
            <button
              type="button"
              className={styles.backButton}
              onClick={backToLogin}
              disabled={loading}
            >
              Voltar para o login
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
