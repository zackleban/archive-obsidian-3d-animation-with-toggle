import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import moment from "moment";
import { load, TFolder } from "./helpers.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  const dom = new JSDOM("<body></body>");
  const { document, HTMLElement, EventTarget } = dom.window;
  const listeners = new Map(), retained = [];
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function(type, fn, options) {
    if (type === "click" && this instanceof HTMLElement) {
      if (!listeners.has(this)) listeners.set(this, new Set());
      listeners.get(this).add(fn); retained.push({ el: this, fn });
    }
    return add.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function(type, fn, options) {
    if (type === "click") listeners.get(this)?.delete(fn);
    return remove.call(this, type, fn, options);
  };
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    const el = this.ownerDocument.createElement(tag);
    el.className = options.cls ?? ""; el.textContent = options.text ?? "";
    for (const [k,v] of Object.entries(options.attr ?? {})) el.setAttribute(k,v);
    this.append(el); return el;
  };
  HTMLElement.prototype.createDiv = function(options) { return this.createEl("div", options); };
  HTMLElement.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
  HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
  const scenes = [], saves = [], events = new Map();
  class GraphScene {
    constructor() { scenes.push(this); this.destroyed = 0; }
    show() { this.shown = true; this.isRunning = false; }
    play() { this.played = true; this.isRunning = true; }
    destroy() { this.destroyed++; }
    recolor() {}
  }
  const { default: Plugin } = await load(process.env.GRAPH_MAIN_SOURCE ?? "src/main.ts", { moment }, { GraphScene });
  let leaves = [];
  const app = {
    vault: { getMarkdownFiles: () => [], getName: () => "Synthetic", getRoot: () => ({ children: [] }), getAllFolders: () => [], configDir: ".obsidian", adapter: { exists: async () => false }, on: () => ({}) },
    metadataCache: { resolvedLinks: {}, on: () => ({}) },
    workspace: { getLeavesOfType: () => leaves, on: (name, fn) => { events.set(name, fn); return {}; }, onLayoutReady: fn => events.set("ready", fn), openLinkText: async () => {} },
  };
  function pane() {
    const containerEl = document.createElement("div"); document.body.append(containerEl);
    containerEl.innerHTML = '<div class="view-content"><div class="graph-controls"><button class="graph-controls-button mod-animate"></button></div></div>';
    const view = { containerEl }, leaf = { view };
    leaves.push(leaf); return { view, leaf, containerEl, toolbar: containerEl.querySelector(".graph-controls"), wand: containerEl.querySelector(".mod-animate") };
  }
  const first = pane(), plugin = new Plugin(app);
  plugin.saveData = async value => saves.push(structuredClone(value));
  await plugin.onload(); events.get("ready")();
  const controls = p => ({ cube: p.containerEl.querySelector(".mod-animate-3d"), toggle: p.containerEl.querySelector(".three-d-toggle"), two: p.containerEl.querySelector('[data-mode="2d"]'), three: p.containerEl.querySelector('[data-mode="3d"]') });
  const layout = () => events.get("layout-change")();
  t.after(() => { plugin.onunload(); dom.window.close(); });
  return { dom, app, plugin, first, pane, controls, layout, scenes, saves, retained, listeners, events, setLeaves: value => { leaves = value; } };
}

test("connected cube does not conceal a removed toggle; fresh controls work and old listeners retire", async t => {
  const f = await fixture(t), old = f.controls(f.first);
  old.toggle.remove(); f.layout(); const current = f.controls(f.first);
  assert.ok(current.toggle, "missing toggle must be replaced");
  assert.notEqual(current.cube, old.cube);
  assert.equal(f.listeners.get(old.cube).size, 0); assert.equal(f.listeners.get(old.three).size, 0);
  current.three.click(); await flush(); assert.equal(f.scenes.length, 1); assert.equal(f.scenes[0].shown, true);
});

for (const mutation of ["replace toolbar", "replace wand", "remove inventory", "detach pane", "defer pane", "move cube", "move toggle"]) {
  test(`stale control clicks before layout are inert: ${mutation}`, async t => {
    const f = await fixture(t), old = f.controls(f.first);
    if (mutation === "replace toolbar") { const next = f.first.toolbar.cloneNode(false); next.append(f.first.wand.cloneNode()); f.first.toolbar.replaceWith(next); f.dom.window.document.body.append(f.first.toolbar); }
    if (mutation === "replace wand") f.first.wand.replaceWith(f.first.wand.cloneNode());
    if (mutation === "remove inventory") f.setLeaves([]);
    if (mutation === "detach pane") f.first.containerEl.remove();
    if (mutation === "defer pane") f.first.leaf.isDeferred = true;
    if (mutation === "move cube") f.dom.window.document.body.append(old.cube);
    if (mutation === "move toggle") f.dom.window.document.body.append(old.toggle);
    old.three.click(); old.cube.click(); await flush();
    assert.equal(f.saves.length, 0, "obsolete controls cannot save a global mode change");
    assert.equal(f.scenes.length, 0, "obsolete controls cannot create a scene");
    f.layout();
    assert.equal(f.listeners.get(old.cube).size, 0); assert.equal(f.listeners.get(old.three).size, 0);
    assert.equal(old.cube.isConnected, false); assert.equal(old.toggle.isConnected, false);
  });
}

test("retired controls cannot change an independent surviving scene, including directly retained callbacks", async t => {
  const f = await fixture(t), second = f.pane(); f.layout();
  const old = f.controls(f.first), survivor = f.controls(second);
  survivor.three.click(); await flush(); const scene = f.scenes[1];
  f.setLeaves([second.leaf]); f.layout(); const saves = f.saves.length;
  old.two.click();
  for (const {el,fn} of f.retained.filter(x => [old.cube, old.two, old.three].includes(x.el))) fn.call(el, new f.dom.window.MouseEvent("click"));
  await flush();
  assert.equal(f.saves.length, saves); assert.equal(scene.destroyed, 0);
  assert.equal(survivor.three.getAttribute("aria-pressed"), "true");
  survivor.cube.click(); await flush(); assert.equal(scene.played, true);
});

test("unload releases native listeners and retained callbacks cannot save or revive; fresh enable works", async t => {
  const f = await fixture(t), old = f.controls(f.first); f.plugin.onunload();
  const callbacks = [...f.retained];
  old.three.click(); for (const {el,fn} of callbacks) fn.call(el, new f.dom.window.MouseEvent("click"));
  await flush(); assert.equal(f.saves.length, 0); assert.equal(f.scenes.length, 0);
  assert.equal([...f.listeners.values()].reduce((n, s) => n + s.size, 0), 0);
  const next = new f.plugin.constructor(f.app); await next.onload(); f.events.get("ready")();
  try { const current = f.controls(f.first); current.cube.click(); await flush(); assert.equal(f.scenes.length, 1); assert.equal(f.scenes[0].played, true); }
  finally { next.onunload(); }
});

test("reconciliation releases a retired scene and a delayed scan cannot recreate it", async t => {
  const f = await fixture(t); let release;
  f.app.vault.getAllFolders = () => [new TFolder("Slow")];
  f.app.vault.adapter.exists = () => new Promise(resolve => { release = resolve; });
  f.controls(f.first).three.click(); f.first.containerEl.remove(); f.layout();
  release(false); await flush(); assert.equal(f.scenes.length, 0);
  f.app.vault.getAllFolders = () => [];
  f.dom.window.document.body.append(f.first.containerEl); f.layout(); await flush();
  assert.equal(f.scenes.length, 1); const scene = f.scenes[0];
  f.first.toolbar.remove(); f.layout(); assert.equal(scene.destroyed, 1);
});

test("unchanged and duplicate pane deliveries preserve one functional control set and bounded listeners", async t => {
  const f = await fixture(t), old = f.controls(f.first);
  f.setLeaves([f.first.leaf, f.first.leaf]);
  for (let i = 0; i < 30; i++) f.layout();
  assert.equal(f.controls(f.first).cube, old.cube);
  assert.equal(f.first.containerEl.querySelectorAll(".mod-animate-3d").length, 1);
  assert.equal([...f.listeners.values()].reduce((n,s) => n+s.size,0), 3);
  old.cube.click(); await flush(); assert.equal(f.scenes.length, 1); assert.equal(f.scenes[0].played, true);
});

for (const mutation of ["removed", "moved", "replaced"]) test(`${mutation} individual mode button is inert and reconciliation restores a complete toggle`, async t => {
  const f = await fixture(t), old = f.controls(f.first);
  if (mutation === "removed") old.three.remove();
  if (mutation === "moved") f.dom.window.document.body.append(old.three);
  if (mutation === "replaced") old.three.replaceWith(old.three.cloneNode(true));
  old.three.click(); await flush();
  assert.equal(f.saves.length, 0); assert.equal(f.scenes.length, 0);
  f.layout(); const current = f.controls(f.first);
  assert.ok(current.three); assert.notEqual(current.three, old.three);
  assert.equal(f.listeners.get(old.three).size, 0);
  assert.equal(old.three.parentElement, null);
  current.three.click(); await flush(); assert.equal(f.scenes.length, 1);
});

test("detach and reattach cycles retire every old listener and preserve unrelated controls", async t => {
  const f = await fixture(t), unrelated = f.first.toolbar.appendChild(f.dom.window.document.createElement("button"));
  for (let i = 0; i < 30; i++) {
    const old = f.controls(f.first); f.first.containerEl.remove(); f.layout();
    assert.equal(old.cube.parentElement, null); assert.equal(old.toggle.parentElement, null);
    assert.equal([...f.listeners.values()].reduce((n,s) => n+s.size,0), 0);
    f.dom.window.document.body.append(f.first.containerEl); f.layout();
    assert.equal(f.first.containerEl.querySelectorAll(".mod-animate-3d").length, 1);
    assert.equal([...f.listeners.values()].reduce((n,s) => n+s.size,0), 3);
  }
  assert.equal(unrelated.parentElement, f.first.toolbar);
  f.controls(f.first).cube.click(); await flush(); assert.equal(f.scenes[0].played, true);
});

test("late layout-ready and layout deliveries after unload create no controls", async t => {
  const f = await fixture(t); f.plugin.onunload();
  f.events.get("ready")(); f.layout(); await flush();
  assert.equal(f.controls(f.first).cube, null); assert.equal(f.controls(f.first).toggle, null);
  assert.equal(f.scenes.length, 0); assert.equal(f.saves.length, 0);
});
