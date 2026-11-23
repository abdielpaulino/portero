import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { createInvitationRepository } from "../auth/invitations.js";
import { validateOrigin } from "../nuvemshop/oauth.js";

export function invitationLink(webOrigin: string, secret: string, production: boolean) {
  validateOrigin(webOrigin, production);
  return `${webOrigin}/activate#codigo=${secret}`;
}
async function main() {
  let database: Pool | undefined;
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--env-file")) throw new Error();
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined));
    if (args.length) { const loaded = config({ path: resolve(args[1]), processEnv: env, quiet: true }); if (loaded.error) throw new Error(); }
    const connection = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(connection.protocol) || connection.port === "6543" || !/^[1-9]\d*$/.test(env.NUVEMSHOP_STORE_ID ?? "")
      || (env.NODE_ENV === "production" && !["require", "verify-ca", "verify-full"].includes(connection.searchParams.get("sslmode") ?? ""))) throw new Error();
    validateOrigin(env.WEB_ORIGIN ?? "", env.NODE_ENV === "production");
    if (!stdin.isTTY || !stdout.isTTY) throw new Error();
    const terminal = createInterface({ input: stdin, output: stdout });
    let email: string, hours: number;
    try {
      stdout.write(`Convite administrativo para a loja ${env.NUVEMSHOP_STORE_ID}. Um convite ativo anterior do mesmo e-mail será revogado.\n`);
      email = await terminal.question("E-mail autorizado: ");
      hours = Number((await terminal.question("Validade em horas [24]: ")) || "24");
      if (await terminal.question("Confirma a loja, o destinatário e a geração? Digite GERAR: ") !== "GERAR") throw new Error();
    } finally { terminal.close(); }
    database = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
    const invite = await createInvitationRepository(database, env.NUVEMSHOP_STORE_ID!).issue(email!, hours!);
    stdout.write(`Link confidencial, de uso único; compartilhar somente com o destinatário:\n${invitationLink(env.WEB_ORIGIN!, invite.secret, env.NODE_ENV === "production")}\nExpira em: ${invite.expiraEm}\n`);
  } catch { console.error("Convite não confirmado. Confira conexão, loja, e-mail e migração; nenhum usuário existente foi alterado."); process.exitCode = 1; }
  finally { await database?.end(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
