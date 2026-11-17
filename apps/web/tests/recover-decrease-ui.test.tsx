import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot, Root } from "react-dom/client";
import { Window } from "happy-dom";
import RecoverDecrease from "../src/app/history/RecoverDecrease";
import type { StockHistoryItem } from "../src/app/history/data";
import { simulatedLocks } from "./locks";
const item:StockHistoryItem={id:7,produtoId:"100",varianteId:"101",quantidade:2,sku:null,status:"registrada",criadoEm:"2026-11-17T10:00:00Z",usuario:{id:1,nome:"Ana",email:"ana@example.test"}};
const operation=(status="registrada")=>({baixaId:7,produtoId:"100",varianteId:"101",quantidade:2,statusSincronizacao:status});
describe("recuperação explícita pelo histórico",()=>{
 const browser=new Window({url:"http://localhost:3000/history"}),originalFetch=globalThis.fetch;
 const globals={window:browser,self:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,Event:browser.Event,IS_REACT_ACT_ENVIRONMENT:true};
 const descriptors=new Map(Object.keys(globals).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let createRoot:typeof CreateRoot,root:Root,container:HTMLElement,calls:string[],changes:number,respond:typeof fetch;
 before(async()=>{for(const[name,value]of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});createRoot=(await import("react-dom/client")).createRoot;});
 beforeEach(async()=>{
  Object.defineProperty(browser.navigator,"locks",{configurable:true,value:simulatedLocks()});browser.localStorage.clear();changes=0;calls=[];
  browser.localStorage.setItem("portero:baixa:100:101",JSON.stringify({produtoId:"100",varianteId:"101",quantidade:2,baixaId:null}));
  respond=async(url)=>Response.json(String(url).endsWith("execute")?operation("sincronizada"):String(url).endsWith("cancel")?operation("rejeitada"):operation());
  globalThis.fetch=async(url,init)=>{
   calls.push(String(url));assert.notEqual(url,"/api/inventory/stock-decreases","Recuperação não cria outra operação");
   if(init?.method==="POST")assert.equal(JSON.parse(browser.localStorage.getItem("portero:baixa:100:101")!).baixaId,7);
   return respond(url,init);
  };
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
  await act(()=>root.render(<RecoverDecrease item={item} onChange={()=>{changes++;}}/>));
 });
 afterEach(async()=>{await act(()=>root.unmount());container.remove();});
 after(async()=>{globalThis.fetch=originalFetch;for(const[name,value]of descriptors){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}await browser.happyDOM.close();});
 async function click(text:string){await act(()=>{const button=[...container.querySelectorAll("button")].find(b=>b.textContent===text);assert.ok(button,text);button.click();});}
 it("não executa ao carregar ou abrir recuperação; adota ID selecionado antes de confirmar",async()=>{
  assert.equal(calls.length,0);await click("Recuperar operação #7");assert.equal(calls.length,0);
  await click("Executar este registro");assert.equal(changes,1);assert.equal(calls.filter(url=>url.endsWith("execute")).length,1);
  assert.ok(calls.includes("/api/inventory?page=1"));assert.equal(browser.localStorage.getItem("portero:baixa:100:101"),null);
 });
 it("cancela explicitamente sem executar e mantém histórico",async()=>{
  await click("Recuperar operação #7");await click("Cancelar registro sem executar");
  assert.ok(calls.some(url=>url.endsWith("cancel")));assert.ok(!calls.some(url=>url.endsWith("execute")));assert.equal(changes,1);
 });
 it("falha ao consultar inventário não transforma a confirmação em resultado incerto",async()=>{
  respond=async(url)=>{if(url==="/api/inventory?page=1")throw new Error("rede");return Response.json(String(url).endsWith("execute")?operation("sincronizada"):operation());};
  await click("Recuperar operação #7");await click("Executar este registro");
  assert.match(container.textContent!,/Baixa confirmada/);assert.equal(changes,1);
  assert.equal(browser.localStorage.getItem("portero:baixa:100:101"),null);
 });
 it("autor sem acesso não executa nem substitui a pendência",async()=>{
  respond=async()=>new Response(null,{status:404});await click("Recuperar operação #7");await click("Executar este registro");
  assert.equal(calls.length,1);assert.equal(changes,0);assert.equal(JSON.parse(browser.localStorage.getItem("portero:baixa:100:101")!).baixaId,null);
 });
});
