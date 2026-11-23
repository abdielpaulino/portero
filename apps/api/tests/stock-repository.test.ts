import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, before, beforeEach, it, mock } from "node:test";
import { Pool } from "pg";
import type { StockRepository, StockRecord } from "../src/stock/service.js";
import { decreaseStock } from "../src/stock/service.js";
const auth={usuarioId:1,lojaId:10}, command={produtoId:"100",varianteId:"101",quantidade:2};
const row: StockRecord={id:7,usuarioId:1,produtoId:"100",variantId:"101",quantidadeBaixada:2,statusSincronizacao:"registrada"};
let repository:StockRepository, queries:{text:string;values:unknown[]}[], released:boolean|undefined;
let access:boolean, lock:boolean, installationLock:boolean, found:boolean, unresolved:boolean, rowCount:number, fail:string|undefined;
let saleStatus: string | undefined, saleValid: boolean;
const events=new EventEmitter(); const previous=process.env.DATABASE_URL;
before(async()=>{
 process.env.DATABASE_URL="postgresql://offline:offline@127.0.0.1:1/offline";
 mock.method(Pool.prototype,"connect",async()=>({
  on:(name:string,listener:()=>void)=>events.on(name,listener), removeListener:(name:string,listener:()=>void)=>events.removeListener(name,listener),
  async query(text:string,values:unknown[]){
   queries.push({text,values}); if(fail&&text.startsWith(fail))throw new Error("erro-sensivel");
   if(text.includes("pg_try_advisory_lock_shared"))return{rows:[{locked:installationLock}]};
   if(text.includes("to_regclass"))return{rows:[{tabela:saleStatus?"itens_venda_externa":null}]};
   if(text.includes("FROM itens_venda_externa"))return{rows:saleStatus?[{id:1,situacao:saleStatus,valida:saleValid}]:[]};
   if(text.startsWith("SELECT situacao FROM vendas_externas"))return{rows:[{situacao:saleStatus}]};
   if(text.includes("FROM usuarios_app"))return{rows:access?[{id:10,nuvemshopStoreId:"67890",accessToken:"ficticio"}]:[]};
   if(text.includes("pg_try_advisory_lock"))return{rows:[{locked:lock}]};
   if(text.includes("pg_advisory_unlock"))return{rows:[{unlocked:true}]};
   if(text.includes("WHERE id = $1"))return text.trim().startsWith("UPDATE")?{rowCount}:{rows:found?[{...row}]:[]};
   if(text.includes("NOT IN"))return{rows:unresolved?[{id:9}]:[]};
   if(text.startsWith("INSERT"))return{rows:[{...row}]};
   return{rows:[]};
  }, release(value:boolean){released=value;}
 }));
 repository=(await import("../src/stock/repository.js")).stockRepository;
});
beforeEach(()=>{queries=[];released=undefined;access=true;lock=true;installationLock=true;found=true;unresolved=false;rowCount=1;fail=undefined;saleStatus=undefined;saleValid=true;});
after(()=>{mock.restoreAll(); if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;});
it("cria usando somente colunas originais, lock PostgreSQL e identidade gerada no banco",async()=>{
 await repository.withLock(auth,command,async context=>{assert.equal(await context.hasUnresolved(),false);assert.equal((await context.create(command)).id,7);});
 const insert=queries.find(q=>q.text.startsWith("INSERT"))!; assert.deepEqual(insert.values,[10,1,"100","101",2]);
 assert.ok(!/requisicao_id|estoque_anterior|estoque_novo|ON CONFLICT/.test(queries.map(q=>q.text).join(" ")));
 assert.deepEqual(queries.find(q=>q.text.includes("pg_try_advisory_lock("))!.values,[10,"101"]);
 assert.match(queries.at(-1)!.text,/pg_advisory_unlock/);assert.equal(released,false);
});
it("desinstalação ou reautorização em curso bloqueia a baixa antes de ler credenciais",async()=>{
 installationLock=false;
 let ran=false;await assert.rejects(repository.withLock(auth,command,async()=>{ran=true;}),{status:503});
 assert.equal(ran,false);assert.equal(queries.length,1);assert.equal(released,false);
 assert.match(queries[0].text,/pg_try_advisory_lock_shared\(7144630821938501::bigint\)/);
});
it("mantém o lock compartilhado durante toda a execução e o libera depois do lock da variante",async()=>{
 await repository.withLock(auth,7,async()=>{
  assert.ok(queries[0].text.includes("pg_try_advisory_lock_shared"));
  assert.ok(queries.every(query=>!query.text.includes("pg_advisory_unlock")));
  const storeQuery=queries.find(query=>query.text.includes("FROM usuarios_app"))!.text;
  assert.match(storeQuery,/length\(btrim\(l.access_token\)\) > 0/);
  assert.match(storeQuery,/l.status IN \('pendente', 'ativa'\)/);
 });
 assert.match(queries.at(-2)!.text,/pg_advisory_unlock\(/);
 assert.match(queries.at(-1)!.text,/pg_advisory_unlock_shared/);
});
it("descarta a conexão se a confirmação de qualquer lock se perder",async()=>{
 for(const point of ["SELECT pg_try_advisory_lock_shared","SELECT pg_try_advisory_lock("]){
  fail=point;await assert.rejects(repository.withLock(auth,command,async()=>{}),{status:503});
  assert.equal(released,true);
 }
});
it("confirma pelo ID e revalida autor/loja, relendo estado depois de adquirir o lock",async()=>{
 await repository.withLock(auth,7,async context=>{assert.equal(context.operation!.id,7);await context.prepare(7,"LUVA");await context.status(7,"sincronizada");});
 const reads=queries.filter(q=>q.text.includes("WHERE id = $1")&&q.text.startsWith("SELECT"));assert.equal(reads.length,2);
 assert.deepEqual(reads[0].values,[7,10,1]);
 const updates=queries.filter(q=>q.text.startsWith("UPDATE"));assert.equal(updates.length,2);
 assert.deepEqual(updates[0].values,[7,10,1,"LUVA"]);assert.deepEqual(updates[1].values,[7,10,1,"sincronizada","em_processamento"]);
 assert.ok(updates.every(q=>!q.text.includes("produto_id =")&&!q.text.includes("quantidade_baixada =")));
});
it("não usa transação aberta durante operação externa e exige transição condicional de estado",async()=>{
 rowCount=0;await assert.rejects(repository.withLock(auth,7,context=>context.prepare(7,null)),{status:503});
 assert.ok(queries.every(q=>!/^BEGIN|^COMMIT/.test(q.text)));assert.equal(released,false);
});
it("vínculo revogado, ID de outro autor e lock ocupado impedem execução do callback",async()=>{
 for(const setting of ["access","found","lock"]){access=true;found=true;lock=true;if(setting==="access")access=false;if(setting==="found")found=false;if(setting==="lock")lock=false;
 let ran=false;await assert.rejects(repository.withLock(auth,7,async()=>{ran=true;}));assert.equal(ran,false);}
});
it("bloqueia pendências persistentes de qualquer autor na variante, excluindo apenas a própria operação",async()=>{
 unresolved=true;await repository.withLock(auth,7,async context=>assert.equal(await context.hasUnresolved(7),true));
 const query=queries.find(q=>q.text.includes("status_sincronizacao NOT IN"))!;assert.deepEqual(query.values,[10,"101",7]);assert.ok(!query.text.includes("usuario_id"));
});
it("descarta conexão quebrada e não expõe erros internos",async()=>{
 await repository.withLock(auth,7,async()=>{events.emit("error",new Error("interno"));});assert.equal(released,true);assert.equal(events.listenerCount("error"),0);
 fail="SELECT pg_advisory_unlock";await repository.withLock(auth,command,async()=>{});assert.equal(released,true);
 fail="INSERT";await assert.rejects(repository.withLock(auth,command,c=>c.create(command)),error=>{assert.ok(error instanceof Error&&!error.message.includes("erro-sensivel"));return true;});
});
it("baixa ligada a venda cancelada é bloqueada também pela rota legada, sem consulta remota",async()=>{
 const enabled=(await import("../src/stock/repository.js")).createStockRepository((await import("../src/db/client.js")).pool,true);
 saleStatus="cancelada";
 const client={async read(){assert.fail("Não deve consultar");},async update(){assert.fail("Não deve enviar");}};
 await assert.rejects(decreaseStock(enabled,client,"67890",auth,7),{status:409});
 assert.ok(queries.some(query=>query.text.includes("pg_try_advisory_lock(1372859531")));
 assert.ok(queries.some(query=>query.text.includes("pg_advisory_unlock(1372859531")));
});
it("desativar a extensão comercial não remove a proteção das vendas já existentes",async()=>{
 saleStatus="cancelada";
 const client={async read(){assert.fail("Não deve consultar");},async update(){assert.fail("Não deve enviar");}};
 await assert.rejects(decreaseStock(repository,client,"67890",auth,7),{status:409});
 assert.ok(queries.some(query=>query.text.includes("FROM itens_venda_externa")));
});
it("vínculo divergente impede execução e confere loja, autor, produto, variante e quantidade",async()=>{
 saleStatus="confirmada";saleValid=false;
 const client={async read(){assert.fail("Não deve consultar");},async update(){assert.fail("Não deve enviar");}};
 await assert.rejects(decreaseStock(repository,client,"67890",auth,7),{status:409});
 const query=queries.find(query=>query.text.includes("FROM itens_venda_externa"))!;
 assert.match(query.text,/v.loja_id=\$2 AND v.usuario_id=\$3 AND i.produto_id=\$4 AND i.variante_id=\$5 AND i.quantidade=\$6/);
 assert.deepEqual(query.values,[7,10,1,"100","101",2]);
});
