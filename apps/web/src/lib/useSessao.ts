"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type Loja = { id: number; nomeLoja: string };

export type Sessao = { usuarioId: number; loja: Loja };

function isSessao(value: unknown): value is Sessao {
  if (typeof value !== "object" || value === null) return false;
  const { usuarioId, loja } = value as Record<string, unknown>;
  return (
    typeof usuarioId === "number" &&
    typeof loja === "object" &&
    loja !== null &&
    typeof (loja as Record<string, unknown>).id === "number" &&
    typeof (loja as Record<string, unknown>).nomeLoja === "string"
  );
}

/**
 * Consulta GET /api/auth/session (rota do back que valida o cookie JWT).
 * Redireciona para /login quando a sessão é inválida/expirada (401)
 * ou quando a loja deixou de estar disponível para o usuário (403).
 */
export function useSessao() {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "same-origin" });

        if (res.status === 401 || res.status === 403) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error(`API /api/auth/session respondeu ${res.status}`);

        const data: unknown = await res.json();
        if (!isSessao(data)) throw new Error("Resposta inválida de /api/auth/session");
        if (ativo) setSessao(data);
      } catch (err) {
        console.error("Erro ao validar sessão:", err);
        if (ativo) setErro(true);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [router]);

  return { sessao, erro };
}
