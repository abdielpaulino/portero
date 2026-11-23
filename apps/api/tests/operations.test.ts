import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { it } from "node:test";
import { compare } from "bcryptjs";
import { createApp } from "../src/app.js";
import { createInvitationRepository, invitationHash } from "../src/auth/invitations.js";
import { createSessionService } from "../src/auth/session.js";
import { operationsFixture } from "./operations-fixture.js";
const auth = { usuarioId: 1, lojaId: 10 }, secret = "segredo-ficticio-operacional-com-mais-32-bytes";
it("convite armazena hash, vincula e-mail/loja e consumo simultâneo cria somente uma conta", async () => {
  const f = operationsFixture(), repo = createInvitationRepository(f.pool, "123");
  const invite = await repo.issue(" Felipe@EXAMPLE.TEST ");
  assert.equal(f.state.invites[0].email, "felipe@example.test"); assert.equal(f.state.invites[0].segredo_hash, invitationHash(invite.secret)); assert.notEqual(f.state.invites[0].segredo_hash, invite.secret);
  const results = await Promise.allSettled([repo.activate(invite.secret, "Felipe", "senha-longa-segura", "senha-longa-segura"), createInvitationRepository(f.pool, "123").activate(invite.secret, "Felipe", "senha-longa-segura", "senha-longa-segura")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state.users.length, 2);
  assert.equal(await compare("senha-longa-segura", f.state.users[1].senha_hash), true);
  await assert.rejects(repo.inspect(invite.secret), { status: 410 });
  assert.ok(!JSON.stringify(results).includes("senha-longa-segura"));
});
it("expiração, revogação, loja ausente e falha no consumo não alteram contas existentes", async () => {
  const f = operationsFixture(), repo = createInvitationRepository(f.pool, "123"), first = await repo.issue("felipe@example.test");
  const second = await repo.issue("felipe@example.test"); await assert.rejects(repo.inspect(first.secret), { status: 410 });
  f.state.now += 25 * 3600000; await assert.rejects(repo.inspect(second.secret), { status: 410 });
  const third = await repo.issue("felipe@example.test"); f.state.fail = "UPDATE convites_conta SET usado";
  await assert.rejects(repo.activate(third.secret, "Felipe", "senha-longa-segura", "senha-longa-segura")); assert.equal(f.state.users.length, 1); assert.equal(f.state.invites.at(-1)!.usado_em, null);
  f.state.fail = ""; f.state.active = false; await assert.rejects(repo.inspect(third.secret), { status: 403 });
  f.state.active = true; await assert.rejects(createInvitationRepository(f.pool, "999").inspect(third.secret), { status: 403 });
});
