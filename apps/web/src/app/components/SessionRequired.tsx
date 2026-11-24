import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { carregarSessao } from "../auth/session";
import { apiOrigin } from "../../../api-origin.cjs";
import styles from "../login/login.module.css";

export default async function SessionRequired({ children }: { children: ReactNode }) {
  const token = (await cookies()).get("portero_session")?.value;
  if (!token) redirect("/login");
  let session;
  try {
    session = await carregarSessao(`${apiOrigin()}/auth/session`, {
      headers: { Cookie: `portero_session=${encodeURIComponent(token)}` }, signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return <main className={styles.container}><div className={styles.card}>
      <h1 className={styles.title}>Acesso indisponível</h1>
      <p className={styles.error} role="alert">Não foi possível verificar sua sessão.</p>
      <Link className={styles.backButton} href="/login">Voltar ao login</Link>
    </div></main>;
  }
  if (!session) redirect("/login");
  return children;
}
