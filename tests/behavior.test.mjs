import test from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { JSDOM } from "jsdom";
import { load, TFile, TFolder, notices } from "./helpers.mjs";
const {buildGraph,findSubvaults}=await load("src/vault-graph.ts",{moment});
function appFor(files=[],links={}){
  return {vault:{getMarkdownFiles:()=>files,getName:()=>"Vault",getRoot:()=>({children:[]}),getAllFolders:()=>[],configDir:".obsidian",adapter:{exists:async()=>false},on:()=>({})},metadataCache:{resolvedLinks:links,on:()=>({})},workspace:{getLeavesOfType:()=>[],on:()=>({}),onLayoutReady:()=>{},openLinkText:async()=>{}}};
}
function note(path,date){const f=new TFile(path);f.stat={ctime:new Date(date).getTime()};return f;}
test("graph orders days, deduplicates reciprocal links and distinguishes same-name clusters",()=>{
  const app=appFor([note("B/Notes/two.md","2026-03-09T12:00:00"),note("A/Notes/one.md","2026-03-07T12:00:00"),note("root.md","2026-03-08T12:00:00")],{"A/Notes/one.md":{"B/Notes/two.md":2,"A/Notes/one.md":1,"absent.md":1},"B/Notes/two.md":{"A/Notes/one.md":1}});
  const graph=buildGraph(app,["A/Notes","B/Notes"]);
  assert.deepEqual(graph.groups,["A/Notes","B/Notes","Vault"]);
  assert.deepEqual(graph.notes.map(n=>n.day),[1,2,3]);assert.equal(graph.days,3);
  assert.equal(graph.links.length,1);assert.equal(graph.notes[0].degree,1);
});
test("empty graph and deepest nested subvault are handled",()=>{
  assert.equal(buildGraph(appFor(),[]).days,1);
  const graph=buildGraph(appFor([note("A/B/n.md","2026-01-01")]),["A","A/B"]);
  assert.deepEqual(graph.groups,["A/B"]);
});
test("folder scan bounds concurrent I/O and respects the config directory",async()=>{
  const app=appFor();app.vault.configDir="custom";
  app.vault.getAllFolders=()=>Array.from({length:45},(_,i)=>new TFolder(`Folder${i}`));
  let active=0,peak=0;
  app.vault.adapter.exists=async path=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return path==="Folder30/custom";};
  assert.deepEqual(await findSubvaults(app),["Folder30"]);assert.ok(peak<=16);
});
test("without nested vaults, graph falls back to top-level folders",async()=>{
  const app=appFor();app.vault.getRoot=()=>({children:[new TFolder("A"),new TFile("root.md")]});
  assert.deepEqual(await findSubvaults(app),["A"]);
});
const dom=new JSDOM('<div id="view"><div class="view-content"><div class="graph-controls"><div class="mod-animate"></div></div></div></div>');
const {document,HTMLElement}=dom.window;
HTMLElement.prototype.createEl=function(tag,options={}) {const el=document.createElement(tag);if(typeof options==="string")el.className=options;else{el.className=options.cls??"";el.textContent=options.text??"";for(const[k,v]of Object.entries(options.attr??{}))el.setAttribute(k,v);}this.append(el);return el;};
HTMLElement.prototype.createDiv=function(options){return this.createEl("div",options);};
HTMLElement.prototype.toggleClass=function(name,on){this.classList.toggle(name,on);};
HTMLElement.prototype.removeClass=function(name){this.classList.remove(name);};
const scenes=[];let failScene=false;
class GraphScene {
  constructor(){if(failScene)throw Error("WebGL unavailable");scenes.push(this);}
  show(){this.shown=true;this.isRunning=false;}
  play(){this.played=true;this.isRunning=true;}
  destroy(){this.destroyed=true;}
  recolor(){}
}
const {default:Plugin}=await load("src/main.ts",{moment},{GraphScene});
function fixture(){
  const app=appFor();const view={containerEl:document.querySelector("#view")};
  const plugin=new Plugin(app);return {app,view,plugin};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test("toggle controls are keyboard buttons with pressed state",async()=>{
  const {plugin,view}=fixture();const wand=view.containerEl.querySelector(".mod-animate");
  const a=plugin.attach(view,wand);plugin.attached.set(view,a);
  assert.equal(a.button.tagName,"BUTTON");
  const options=a.toggle.querySelectorAll("button");assert.equal(options.length,2);
  assert.equal(options[0].getAttribute("aria-pressed"),"true");
  options[1].click();await flush();assert.equal(options[1].getAttribute("aria-pressed"),"true");
  plugin.onunload();assert.equal(a.button.isConnected,false);assert.equal(a.scene,null);
});
test("late folder scan cannot resurrect a scene after switching back to 2D",async()=>{
  const {app,plugin,view}=fixture();let release;app.vault.getAllFolders=()=>[new TFolder("Slow")];
  app.vault.adapter.exists=()=>new Promise(resolve=>{release=resolve;});
  const a=plugin.attach(view,view.containerEl.querySelector(".mod-animate"));plugin.attached.set(view,a);
  plugin.setMode("3d");plugin.setMode("2d");release(false);await flush();
  assert.equal(a.scene,null);plugin.onunload();
});
test("late folder scan cannot resurrect an unloaded plugin",async()=>{
  const {app,plugin,view}=fixture();let release;app.vault.getAllFolders=()=>[new TFolder("Slow")];
  app.vault.adapter.exists=()=>new Promise(resolve=>{release=resolve;});
  const a=plugin.attach(view,view.containerEl.querySelector(".mod-animate"));plugin.attached.set(view,a);
  plugin.setMode("3d");plugin.onunload();release(false);await flush();assert.equal(a.scene,null);
});
test("WebGL failure returns to 2D and shows a useful notice",async()=>{
  const {plugin,view}=fixture();const a=plugin.attach(view,view.containerEl.querySelector(".mod-animate"));plugin.attached.set(view,a);
  failScene=true;const log=console.error;console.error=()=>{};
  try{plugin.setMode("3d");await flush();assert.equal(plugin.prefs.mode,"2d");assert.equal(a.scene,null);assert.match(notices.at(-1),/WebGL/);}
  finally{failScene=false;console.error=log;plugin.onunload();}
});
test("metadata refresh cannot cancel an animation that is still loading",async()=>{
  const {app,plugin,view}=fixture();const a=plugin.attach(view,view.containerEl.querySelector(".mod-animate"));plugin.attached.set(view,a);
  plugin.setMode("3d");await flush();
  let release;app.vault.getAllFolders=()=>[new TFolder("Slow")];
  app.vault.adapter.exists=()=>new Promise(resolve=>{release=resolve;});
  const play=plugin.render(view,a,true);plugin.refreshAll();release(false);await play;
  assert.equal(a.scene.played,true);assert.equal(a.loadingAnimation,false);plugin.onunload();
});
const {GraphScene:RealGraphScene}=await load("src/scene.ts",{moment});
test("right-button clicks never schedule opening a note",()=>{
  let scheduled=0;
  const scene={downAt:null,holdTimer:0,grabbedAt:null,el:{win:{clearTimeout(){},setTimeout(){scheduled++;}}},release(){}};
  RealGraphScene.prototype.onDown.call(scene,{button:2,clientX:10,clientY:10});
  RealGraphScene.prototype.onUp.call(scene,{button:2,clientX:10,clientY:10});
  assert.equal(scheduled,0);
});
