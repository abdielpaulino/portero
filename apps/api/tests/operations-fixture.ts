import { EventEmitter } from "node:events";
import type { Pool } from "pg";

// Simulação transacional para testes; a implementação usa locks e estado do PostgreSQL.
export function operationsFixture() {
  const state = { active: true, lifecycleBusy: false, variantBusy: false, controlHeld: false, fail: "", now: Date.now(),
    users: [{ id: 1, loja_id: 10, nome: "Administradora", email: "admin@example.test", senha_hash: "hash-inicial" }],
    invites: [] as Record<string, any>[], reviews: [] as Record<string, any>[], alerts: [] as Record<string, any>[], settings: null as Record<string, any> | null,
    operation: { id: 7, loja_id: 10, usuario_id: 1, produto_id: "100", variant_id: "101", quantidade_baixada: 3, status_sincronizacao: "incerta" } };
  const queries: { text: string; values: any[] }[] = [];
  let tail = Promise.resolve();
  const store = { id: 10, nuvemshopStoreId: "123", accessToken: "token-ficticio", status: "ativa", conectada: true };
  async function execute(text: string, values: any[] = []) {
    queries.push({ text, values });
    if (state.fail && text.startsWith(state.fail)) throw new Error("falha-simulada");
    const result = (rows: any[] = [], rowCount = rows.length) => ({ rows: structuredClone(rows), rowCount });
    if (text.includes("pg_try_advisory_xact_lock_shared")) return result([{ locked: !state.lifecycleBusy }]);
    if (text.includes("pg_try_advisory_lock_shared")) return result([{ locked: !state.lifecycleBusy }]);
    if (text.includes("pg_try_advisory_xact_lock") && text.includes("hashtext")) return result([{ locked: !state.variantBusy }]);
    if (text.includes("pg_try_advisory_xact_lock(1372859533")) return result([{ locked: !state.controlHeld }]);
    if (text.includes("pg_try_advisory_lock(1372859533")) { const locked = !state.controlHeld; if (locked) state.controlHeld = true; return result([{ locked }]); }
    if (text.includes("pg_advisory_unlock(1372859533")) { state.controlHeld = false; return result([{ unlocked: true }]); }
    if (text.includes("pg_advisory_unlock")) return result([{ unlocked: true }]);
    if (text.includes("FROM usuarios_app u")) return result(state.active && state.users.some(user => user.id === values[0] && user.loja_id === values[1]) && values[2] === "123" ? [store] : []);
    if (text.includes("FROM lojas") && text.includes("access_token")) return result(state.active ? [store] : []);
    if (text.startsWith("SELECT id FROM lojas")) return result([{ id: 10 }]);
    if (text.startsWith("SELECT id FROM usuarios_app WHERE lower")) return result(state.users.filter(user => user.email.trim().toLowerCase() === values[0]));
    if (text.startsWith("UPDATE convites_conta SET revogado")) { for (const invite of state.invites) if (invite.loja_id === values[0] && invite.email === values[1] && !invite.usado_em && !invite.revogado_em) invite.revogado_em = new Date(state.now); return result(); }
    if (text.startsWith("INSERT INTO convites_conta")) {
      const invite = { id: state.invites.length + 1, loja_id: values[0], email: values[1], segredo_hash: values[2], expira_em: new Date(state.now + values[3] * 3600000), usado_em: null, revogado_em: null };
      state.invites.push(invite); return result([{ expira_em: invite.expira_em }]);
    }
    if (text.includes("FROM convites_conta WHERE segredo_hash")) return result(state.invites.filter(invite => invite.segredo_hash === values[0] && invite.loja_id === values[1] && !invite.usado_em && !invite.revogado_em && invite.expira_em.getTime() > state.now));
    if (text.startsWith("INSERT INTO usuarios_app")) { const user = { id: state.users.length + 1, loja_id: values[0], nome: values[1], email: values[2], senha_hash: values[3] }; state.users.push(user); return result([{ id: user.id }]); }
    if (text.startsWith("UPDATE convites_conta SET usado")) { const invite = state.invites.find(invite => invite.id === values[0] && !invite.usado_em && !invite.revogado_em && invite.expira_em.getTime() > state.now); if (!invite) return result(); invite.usado_em = new Date(state.now); invite.usuario_id = values[1]; return result([], 1); }
    if (text.includes("FROM baixas_estoque") && text.includes("WHERE id=$1 AND loja_id=$2")) return result(state.operation.id === values[0] && state.operation.loja_id === values[1] ? [state.operation] : []);
    if (text.startsWith("SELECT id,conteudo_hash,status_final FROM conferencias")) return result(state.reviews.filter(review => review.loja_id === values[0] && review.requisicao_id === values[1]));
    if (text.startsWith("INSERT INTO conferencias_baixa")) {
      if (state.reviews.some(review => review.loja_id === values[0] && review.requisicao_id === values[3])) return result();
      const [loja_id,baixa_id,usuario_id,requisicao_id,conteudo_hash,conclusao,quantidade_comprovada,evidencia_tipo,evidencia_referencia,justificativa,status_anterior,status_final] = values;
      const row = { id: state.reviews.length + 1,loja_id,baixa_id,usuario_id,requisicao_id,conteudo_hash,conclusao,quantidade_comprovada,evidencia_tipo,evidencia_referencia,justificativa,status_anterior,status_final };
      state.reviews.push(row); return result([{ id: row.id }]);
    }
    if (text.startsWith("UPDATE baixas_estoque SET status_sincronizacao")) { if (state.operation.id !== values[0] || state.operation.loja_id !== values[1] || state.operation.status_sincronizacao !== values[3]) return result(); state.operation.status_sincronizacao = values[2]; return result([], 1); }
    if (text.includes("FROM conferencias_baixa c JOIN")) return result(state.reviews.filter(review => review.baixa_id === values[0] && review.loja_id === values[1]).map(review => ({ id: review.id, conclusao: review.conclusao, quantidadeComprovada: review.quantidade_comprovada,
      evidenciaTipo: review.evidencia_tipo, evidenciaReferencia: review.evidencia_referencia, justificativa: review.justificativa, criadoEm: new Date(state.now), responsavel: "Administradora", usuarioId: review.usuario_id })));
    if (text.startsWith("SELECT limite_ruptura")) return result(state.settings ? [state.settings] : []);
    if (text.startsWith("UPDATE configuracoes_loja SET monitor_id")) { if (!state.settings?.notificacoesAtivas) return result(); state.settings.monitor_id = values[1]; return result([state.settings]); }
    if (text.startsWith("SELECT loja_id FROM configuracoes_loja")) return result(state.settings?.monitor_id === values[1] ? [{ loja_id: values[0] }] : []);
    if (text.startsWith("INSERT INTO configuracoes_loja") || text.startsWith("UPDATE configuracoes_loja SET limite")) {
      const insert = text.startsWith("INSERT");
      if (insert ? !!state.settings : state.settings?.versao !== values[7]) return result();
      state.settings = { lojaId: values[0], limiteRuptura: values[1], notificacoesAtivas: values[2], emailNotificacoes: values[3], atualizacaoAutomatica: values[4], intervaloSegundos: values[5], atualizadoPor: values[6], versao: (state.settings?.versao ?? 0) + 1, monitorProximaPagina: state.settings?.monitorProximaPagina ?? 1 };
      return result([state.settings]);
    }
    if (text.startsWith("SELECT variante_id AS")) return result(state.alerts.filter(alert => alert.abaixo_limite && ["pendente", "em_envio", "incerto", "falhou"].includes(alert.estado)).map(alert => ({ varianteId: alert.variante_id, estado: alert.estado, eventoId: alert.evento_id })));
    if (text.startsWith("INSERT INTO alertas_estoque")) {
      for (const item of JSON.parse(values[3])) {
        const below = item.quantidade !== null && item.quantidade <= values[1], old = state.alerts.find(alert => alert.variante_id === item.variante);
        if (!old) state.alerts.push({ loja_id: values[0], variante_id: item.variante, produto_id: item.produto, nome_produto: item.nome, quantidade: item.quantidade, limite: values[1], abaixo_limite: below, evento_id: item.evento, estado: below ? "pendente" : "normal", destinatario: values[2] });
        else {
          if (!old.abaixo_limite && below) { old.evento_id = item.evento; old.estado = "pendente"; }
          else if (!below) old.estado = "normal";
          if (old.estado === "pendente") old.destinatario = values[2];
          Object.assign(old, { quantidade: item.quantidade, limite: values[1], abaixo_limite: below });
        }
      } return result();
    }
    if (text.startsWith("UPDATE configuracoes_loja SET monitor_proxima")) { Object.assign(state.settings!, { monitorProximaPagina: values[1], monitorResultado: values[2], monitorEm: new Date(state.now) }); return result([], 1); }
    if (text.startsWith("UPDATE alertas_estoque SET estado='em_envio'")) { const alert = state.alerts.find(alert => alert.abaixo_limite && alert.estado === "pendente"); if (!alert) return result(); alert.estado = "em_envio"; return result([alert], 1); }
    if (text.startsWith("UPDATE alertas_estoque SET estado='enviado'")) { const alert = state.alerts.find(alert => alert.evento_id === values[1] && alert.estado === "em_envio"); if (!alert) return result(); alert.estado = "enviado"; alert.provedor_id = values[2]; return result([], 1); }
    if (text.startsWith("UPDATE alertas_estoque SET estado='incerto'")) { const alert = state.alerts.find(alert => alert.evento_id === values[1] && alert.estado === "em_envio"); if (alert) alert.estado = "incerto"; return result([], alert ? 1 : 0); }
    throw new Error("Consulta não simulada: " + text.slice(0, 120));
  }
  const pool = { query: execute, async connect() {
    const events = new EventEmitter(); let unlock: (() => void) | undefined, snapshot: any;
    return { on: events.on.bind(events), removeListener: events.removeListener.bind(events), release() { unlock?.(); unlock = undefined; },
      async query(text: string, values: any[] = []) {
        if (text === "BEGIN") { const previous = tail; tail = new Promise<void>(resolve => { unlock = resolve; }); await previous; snapshot = structuredClone({ users: state.users, invites: state.invites, reviews: state.reviews, operation: state.operation, settings: state.settings, alerts: state.alerts }); queries.push({ text, values }); return { rows: [] }; }
        if (text === "COMMIT" || text === "ROLLBACK") { if (text === "ROLLBACK" && snapshot) Object.assign(state, snapshot); queries.push({ text, values }); unlock?.(); unlock = undefined; return { rows: [] }; }
        return execute(text, values);
      } };
  } } as unknown as Pool;
  return { pool, state, queries };
}
