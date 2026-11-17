import assert from "node:assert/strict";
import { it } from "node:test";
import { comTravaDaBaixa, criarBaixa, enviarBaixa, guardarBaixa, lerBaixaPendente, limparBaixa, quantidadeValida, registrarBaixa } from "../src/app/inventory/stock-decrease";
import { simulatedLocks } from "./locks";
const item={produtoId:"100",varianteId:"101"};
const draft=criarBaixa(item,2), saved={...draft,baixaId:7};
const operation=(status="registrada")=>({...saved,statusSincronizacao:status});
function storage(){let value:string|null=null;return{getItem(){return value;},setItem(_key:string,text:string){value=text;},removeItem(){value=null;}};}
it("valida quantidade e cria somente uma intenção sem ID",()=>{
 for(const value of [0,-1,1.5,NaN,Infinity,2147483648])assert.equal(quantidadeValida(value),false);
 assert.equal(quantidadeValida(2),true);assert.equal(draft.baixaId,null);
});
it("guarda a intenção antes do ID e recupera o mesmo ID após recarga",()=>{
 const db=storage();guardarBaixa(draft,db);assert.deepEqual(lerBaixaPendente(item,db),draft);
 guardarBaixa(saved,db);assert.deepEqual(lerBaixaPendente(item,db),saved);
 assert.throws(()=>guardarBaixa({...saved,baixaId:8},db));
 limparBaixa({...saved,baixaId:8},db);assert.deepEqual(lerBaixaPendente(item,db),saved);
 limparBaixa(saved,db);assert.equal(lerBaixaPendente(item,db),null);
});
it("criação envia apenas dados locais e exige resposta identificada e correspondente",async()=>{
 const registered=await registrarBaixa(draft,async(url,init)=>{
 assert.equal(url,"/api/inventory/stock-decreases");assert.equal(init?.method,"POST");
 assert.equal(new Headers(init?.headers).get("Idempotency-Key"),null);assert.deepEqual(JSON.parse(init!.body as string),{...item,quantidade:2});
 return Response.json(operation(),{status:201});});assert.deepEqual(registered,saved);
 for(const data of [{},operation("sincronizada"),{...operation(),quantidade:9}])await assert.rejects(registrarBaixa(draft,async()=>Response.json(data,{status:201})),/histórico/);
});
it("perda da resposta de criação conserva marca sem ID e nunca solicita execução",async()=>{
 const db=storage();guardarBaixa(draft,db);await assert.rejects(registrarBaixa(draft,async()=>{throw new Error("rede");}),/histórico/);
 let requests=0;const result=await enviarBaixa(lerBaixaPendente(item,db)!,async()=>{requests++;throw new Error();});
 assert.equal(result.kind,"pending");assert.equal(requests,0);assert.equal(lerBaixaPendente(item,db)!.baixaId,null);
});
it("confirma somente o ID já salvo e não substitui dados na execução",async()=>{
 const urls:string[]=[];const result=await enviarBaixa(saved,async(url,init)=>{
 urls.push(String(url));if(init?.method==="POST"){assert.equal(init.body,"{}");return Response.json(operation("sincronizada"));}
 return Response.json(operation());});assert.equal(result.kind,"success");
 assert.deepEqual(urls,["/api/inventory/stock-decreases/7","/api/inventory/stock-decreases/7/execute"]);
});
it("concluída, incerta e em processamento são apenas consultadas, sem reenvio",async()=>{
 for(const status of ["sincronizada","incerta","em_processamento","rejeitada","pendente"]){let calls=0;
 const result=await enviarBaixa(saved,async(_url,init)=>{calls++;assert.notEqual(init?.method,"POST");return Response.json(operation(status));});
 assert.equal(calls,1);assert.equal(result.kind,status==="sincronizada"?"success":status==="rejeitada"?"rejected":"pending");}
});
it("recusa ID ou dados divergentes e mantém sessão expirada como pendência",async()=>{
 for(const value of [{...operation(),baixaId:8},{...operation(),quantidade:9}]){
 let posts=0;const result=await enviarBaixa(saved,async(_url,init)=>{if(init?.method==="POST")posts++;return Response.json(value);});assert.equal(result.kind,"pending");assert.equal(posts,0);}
 assert.equal((await enviarBaixa(saved,async()=>new Response(null,{status:401}))).kind,"pending");
});
it("falha da execução conserva o ID e retomada confirma sem criar outra operação",async()=>{
 const db=storage();guardarBaixa(saved,db);let calls=0;
 const first=await enviarBaixa(saved,async()=>{if(calls++)throw new Error("rede");return Response.json(operation());});assert.equal(first.kind,"pending");
 const second=await enviarBaixa(lerBaixaPendente(item,db)!,async(_url,init)=>{assert.notEqual(init?.method,"POST");return Response.json(operation("sincronizada"));});assert.equal(second.kind,"success");
});
it("saldo zero confirmado como incerto permanece pendente com mensagem de conferência",async()=>{
 let count=0;const result=await enviarBaixa(saved,async()=>count++?Response.json({...operation("incerta"),message:"Saldo zero exige conferência."},{status:409}):Response.json(operation()));
 assert.equal(result.kind,"pending");assert.match(result.message,/zero.*conferência/);
});
it("recuperação explícita do histórico pode vincular um ID à criação sem resposta",()=>{
 const db=storage();guardarBaixa(draft,db);guardarBaixa(saved,db,true);assert.equal(lerBaixaPendente(item,db)!.baixaId,7);
 db.setItem("",JSON.stringify({...draft,key:"uuid-antigo"}));assert.equal(lerBaixaPendente(item,db)!.baixaId,null);
});
it("trava de navegador recusa duas abas simultâneas e não mantém fila",async()=>{
 const locks=simulatedLocks();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const first=comTravaDaBaixa(item,()=>gate,locks);await assert.rejects(comTravaDaBaixa(item,async()=>{},locks),/outra aba/);release();await first;
 await assert.rejects(comTravaDaBaixa(item,async()=>{},{} as Pick<LockManager,"request">),/navegador/);
});
