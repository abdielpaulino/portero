import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { act } from "react";
import type { createRoot as CreateRoot, Root } from "react-dom/client";
import { Window } from "happy-dom";
import StockDecrease from "../src/app/inventory/StockDecrease";
import type { Item } from "../src/app/inventory/data";
import { simulatedLocks } from "./locks";
const item:Item={id:"100:101",produtoId:"100",varianteId:"101",nome:"Luva",variante:"Azul",sku:"LUVA",preco:100,quantidade:8,ruptura:false};
const key="portero:baixa:100:101";
const operation=(status="registrada")=>({baixaId:7,produtoId:"100",varianteId:"101",quantidade:1,statusSincronizacao:status});
describe("interface em duas etapas",()=>{
 const browser=new Window({url:"http://localhost:3000"}),originalFetch=globalThis.fetch;
 const globals={window:browser,self:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,HTMLInputElement:browser.HTMLInputElement,Event:browser.Event,IS_REACT_ACT_ENVIRONMENT:true};
 const descriptors=new Map(Object.keys(globals).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let createRoot:typeof CreateRoot,root:Root,container:HTMLElement,successes:number,calls:{url:string;init?:RequestInit}[],respond:typeof fetch;
 before(async()=>{for(const[name,value]of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});createRoot=(await import("react-dom/client")).createRoot;});
 beforeEach(async()=>{
  Object.defineProperty(browser.navigator,"locks",{configurable:true,value:simulatedLocks()});browser.localStorage.clear();browser.sessionStorage.clear();successes=0;calls=[];
  respond=async(url)=>Response.json(operation(String(url).endsWith("execute")?"sincronizada":"registrada"),{status:url==="/api/inventory/stock-decreases"?201:200});
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});const stored=JSON.parse(browser.localStorage.getItem(key)!);
    if(String(url).endsWith("execute"))assert.equal(stored.baixaId,7,"ID deve estar persistido antes da execução");
    return respond(url,init);};
  container=document.createElement("div");document.body.append(container);root=createRoot(container);await mount();
 });
 afterEach(async()=>{await act(()=>root.unmount());container.remove();});
 after(async()=>{globalThis.fetch=originalFetch;for(const[name,value]of descriptors){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}await browser.happyDOM.close();});
 async function mount(){await act(()=>root.render(<StockDecrease item={item} onSuccess={()=>{successes++;}} onBusyChange={()=>{}}/>));}
 async function click(text:string){await act(()=>{const button=[...container.querySelectorAll("button")].find(b=>b.textContent===text);assert.ok(button,text);button.click();});}
 async function submit(){await act(()=>{container.querySelector("form")!.dispatchEvent(new browser.Event("submit",{bubbles:true,cancelable:true}) as unknown as Event);});}
 it("um clique confirma as duas etapas e salva ID antes da execução",async()=>{
  await click("Dar baixa");await submit();assert.equal(successes,1);
  assert.deepEqual(calls.map(c=>c.url),["/api/inventory/stock-decreases","/api/inventory/stock-decreases/7","/api/inventory/stock-decreases/7/execute"]);
  assert.equal(browser.localStorage.getItem(key),null);
 });
 it("fechar antes do envio não cria operação",async()=>{await click("Dar baixa");await click("Fechar");assert.equal(calls.length,0);});
 it("perda da criação oferece histórico e bloqueia outra criação após fechar e remontar",async()=>{
  respond=async()=>{throw new Error("rede");};await click("Dar baixa");await submit();assert.equal(calls.length,1);assert.equal(successes,0);
  assert.ok(container.textContent?.includes("histórico"));assert.equal(JSON.parse(browser.localStorage.getItem(key)!).baixaId,null);
  await click("Fechar");await click("Dar baixa");await submit();assert.equal(calls.length,1);
  await act(()=>root.unmount());root=createRoot(container);await mount();await click("Dar baixa");await submit();assert.equal(calls.length,1);
 });
 it("perda da execução retoma o mesmo ID e consulta conclusão sem outro POST",async()=>{
  respond=async(url)=>{if(String(url).endsWith("execute"))throw new Error("rede");return Response.json(operation(),{status:url==="/api/inventory/stock-decreases"?201:200});};
  await click("Dar baixa");await submit();assert.equal(JSON.parse(browser.localStorage.getItem(key)!).baixaId,7);
  await click("Fechar");await click("Dar baixa");respond=async()=>Response.json(operation("sincronizada"));await submit();
  assert.equal(successes,1);assert.equal(calls.filter(c=>c.init?.method==="POST").length,2);
 });
 it("incerteza mantém ID, não confirma e não reenfileira a operação",async()=>{
  let state="registrada";respond=async(url)=>{if(String(url).endsWith("execute"))state="incerta";return Response.json({...operation(state),message:"Saldo zero exige conferência."},{status:url==="/api/inventory/stock-decreases"?201:state==="incerta"?409:200});};
  await click("Dar baixa");await submit();assert.equal(successes,0);assert.match(container.textContent!,/conferência/);
  respond=async()=>Response.json(operation("incerta"));await submit();assert.equal(calls.filter(c=>c.url.endsWith("execute")).length,1);
 });
 it("não envia execução se guardar ID falhar",async()=>{
  const original=browser.localStorage;
  Object.defineProperty(browser,"localStorage",{configurable:true,value:{
    getItem:original.getItem.bind(original),removeItem:original.removeItem.bind(original),
    setItem(name:string,value:string){if(JSON.parse(value).baixaId!==null)throw new Error("sem espaço");original.setItem(name,value);}
  }});
  try{await click("Dar baixa");await submit();assert.equal(calls.length,1);assert.equal(successes,0);assert.equal(JSON.parse(browser.localStorage.getItem(key)!).baixaId,null);}
  finally{Object.defineProperty(browser,"localStorage",{configurable:true,value:original});}
 });
 it("bloqueia duplo envio enquanto a criação está em andamento",async()=>{
  let release!:(response:Response)=>void;respond=async()=>await new Promise<Response>(resolve=>{release=resolve;});
  await click("Dar baixa");await submit();await submit();assert.equal(calls.length,1);
  respond=async(url)=>Response.json(operation(String(url).endsWith("execute")?"sincronizada":"registrada"));
  await act(()=>release(Response.json(operation(),{status:201})));assert.equal(successes,1);
 });
});
