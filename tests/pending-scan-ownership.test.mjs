import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import moment from "moment";
import { load, TFile, TFolder } from "./helpers.mjs";

// Actual main + vault-graph; only host inventory/events, persistence and scene are
// doubled. Native DOM ownership changes are independent of delivered layout events.
// Deferred adapter reads are already issued and deliberately are not cancelled.
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, { saved = "3d", delayed = true } = {}) {
  const dom = new JSDOM("<body></body>");
  const { document, HTMLElement } = dom.window;
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    const el = this.ownerDocument.createElement(tag);
    el.className = options.cls ?? ""; el.textContent = options.text ?? "";
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
    this.append(el); return el;
  };
  HTMLElement.prototype.createDiv = function(options) { return this.createEl("div", options); };
  HTMLElement.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
  HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
  const scenes = [], saves = [], notices = [], scans = [], events = new Map();
  const diagnostics = t.mock.method(console, "error", () => {});
  class GraphScene {
    constructor(content) { this.content = content; this.shows = 0; this.plays = 0; this.destroyed = 0; scenes.push(this); }
    show(graph) { this.graph = graph; this.shows++; this.isRunning = false; }
    play(graph) { this.graph = graph; this.plays++; this.isRunning = true; }
    destroy() { this.destroyed++; this.isRunning = false; }
    recolor() {}
  }
  const { default: Plugin } = await load(process.env.GRAPH_MAIN_SOURCE ?? "src/main.ts", {
    moment, Notice: class { constructor(message) { notices.push(message); } },
  }, { GraphScene });
  let leaves = [];
  const folder = new TFolder("Notes"), note = new TFile("Notes/one.md");
  note.stat = { ctime: new Date("2026-01-01T12:00:00").getTime() };
  const app = {
    vault: {
      getMarkdownFiles: () => [note], getName: () => "Synthetic", getRoot: () => ({ children: [folder] }),
      getAllFolders: () => [folder], configDir: ".obsidian", on: () => ({}),
      adapter: { exists: path => {
        assert.equal(path, "Notes/.obsidian");
        if (!delayed) return Promise.resolve(false);
        return new Promise((resolve, reject) => scans.push({ resolve, reject }));
      } },
    },
    metadataCache: { resolvedLinks: {}, on: (name, fn) => { events.set(name, fn); return {}; } },
    workspace: {
      getLeavesOfType: () => leaves, on: (name, fn) => { events.set(name, fn); return {}; },
      onLayoutReady: fn => events.set("ready", fn), openLinkText: async () => {},
    },
  };
  function pane() {
    const containerEl = document.createElement("div"); document.body.append(containerEl);
    containerEl.innerHTML = '<div class="view-content"><div class="graph-controls"><button class="graph-controls-button mod-animate"></button></div></div>';
    const view = { containerEl }, leaf = { view, isDeferred: false }; leaves.push(leaf);
    return { view, leaf, containerEl, toolbar: containerEl.querySelector(".graph-controls"), wand: containerEl.querySelector(".mod-animate") };
  }
  const first = pane(), plugin = new Plugin(app);
  plugin.saved = { mode: saved };
  plugin.saveData = async value => { plugin.saved = structuredClone(value); saves.push(structuredClone(value)); };
  t.after(async () => { plugin.onunload(); for (const scan of scans) scan.resolve(false); await flush(); dom.window.close(); });
  await plugin.onload(); events.get("ready")();
  const controls = p => ({ cube: p.containerEl.querySelector(".mod-animate-3d"), toggle: p.containerEl.querySelector(".three-d-toggle"), two: p.containerEl.querySelector('[data-mode="2d"]'), three: p.containerEl.querySelector('[data-mode="3d"]') });
  return { dom, app, plugin, first, pane, controls, scenes, saves, notices, scans, events, diagnostics,
    layout: () => events.get("layout-change")(), setLeaves: value => { leaves = value; } };
}
function state(f) {
  return { scenes: f.scenes.map(s => ({ shows: s.shows, plays: s.plays, destroyed: s.destroyed })),
    mode: f.plugin.prefs.mode, saved: f.plugin.saved, saves: f.saves, notices: f.notices,
    diagnostics: f.diagnostics.mock.callCount() };
}
const healthy = { scenes: [{ shows: 1, plays: 0, destroyed: 0 }], mode: "3d", saved: { mode: "3d" }, saves: [], notices: [], diagnostics: 0 };
function mutate(f, p, kind) {
  const c = f.controls(p);
  if (kind === "inventory removal") { f.setLeaves([f.first.leaf]); return () => f.setLeaves([f.first.leaf, p.leaf]); }
  if (kind === "pane detachment") { p.containerEl.remove(); return () => f.dom.window.document.body.append(p.containerEl); }
  if (kind === "deferred pane") { p.leaf.isDeferred = true; return () => { p.leaf.isDeferred = false; }; }
  if (kind === "wand replacement") p.wand.replaceWith(p.wand.cloneNode());
  if (kind === "toolbar replacement") { const next = p.toolbar.cloneNode(false); next.append(p.wand.cloneNode()); p.toolbar.replaceWith(next); f.dom.window.document.body.append(p.toolbar); }
  if (kind === "toggle removal") c.toggle.remove();
  if (kind === "cube movement") f.dom.window.document.body.append(c.cube);
  if (kind === "toggle movement") f.dom.window.document.body.append(c.toggle);
  if (kind === "option replacement") c.three.replaceWith(c.three.cloneNode(true));
  if (kind === "option movement") f.dom.window.document.body.append(c.two);
  return () => {};
}

for (const kind of ["inventory removal", "pane detachment", "deferred pane", "wand replacement", "toolbar replacement", "toggle removal", "cube movement", "toggle movement", "option replacement", "option movement"]) {
  for (const outcome of ["show", "play", "reject"]) test(`pending ${outcome} ignores ${kind} before layout and fresh ownership works`, async t => {
    const f = await fixture(t);
    f.scans[0].resolve(false); await flush(); assert.deepEqual(state(f), healthy);
    const p = f.pane(); f.layout(); const old = f.controls(p);
    assert.equal(f.scans.length, 2);
    let pending = f.scans[1];
    if (outcome === "play") {
      old.cube.click(); assert.equal(f.scans.length, 3);
      pending.resolve(false); await flush(); pending = f.scans[2];
      assert.deepEqual(state(f), healthy, "superseded initial scan must not show");
    }
    const restore = mutate(f, p, kind);
    // No layout-change is delivered between mutation and async consumption.
    if (outcome === "reject") pending.reject(new Error("obsolete scan")); else pending.resolve(false);
    await flush();
    assert.deepEqual(state(f), healthy, "stale completion cannot allocate/show/play, destroy survivor, save 2D or report");
    assert.equal(f.controls(f.first).three.getAttribute("aria-pressed"), "true");
    assert.equal(old.cube.classList.contains("is-running"), false);
    f.layout(); restore(); f.layout();
    const fresh = f.controls(p); assert.ok(fresh.cube); assert.notEqual(fresh.cube, old.cube);
    assert.equal(f.scans.length, outcome === "play" ? 4 : 3);
    f.scans.at(-1).resolve(false); await flush();
    assert.equal(f.scenes.length, 2); assert.equal(f.scenes[1].shows, 1);
    assert.equal(f.scenes[0].destroyed, 0); assert.equal(f.notices.length, 0);
    fresh.cube.click(); f.scans.at(-1).resolve(false); await flush();
    assert.equal(f.scenes[1].plays, 1); assert.equal(f.scenes[1].graph.notes[0].path, "Notes/one.md");
  });
}

for (const delayed of [true, false]) test(`saved-3D initial attachment and new pane render (${delayed ? "delayed" : "immediate"} adapter)`, async t => {
  const f = await fixture(t, { delayed });
  if (delayed) { assert.equal(f.scenes.length, 0); f.scans[0].resolve(false); }
  await flush(); assert.deepEqual(state(f), healthy);
  const p = f.pane(); f.layout(); if (delayed) f.scans[1].resolve(false);
  await flush(); assert.equal(f.scenes.length, 2); assert.equal(f.scenes[1].shows, 1);
  f.controls(p).cube.click(); if (delayed) f.scans[2].resolve(false);
  await flush(); assert.equal(f.scenes[1].plays, 1); assert.equal(f.scenes[0].destroyed, 0);
});

for (const saved of ["2d", "3d"]) test(`current scan failure from saved ${saved} restores global 2D once and deliberate retry works`, async t => {
  const f = await fixture(t, { saved });
  if (saved === "2d") f.controls(f.first).three.click();
  f.scans[0].resolve(false); await flush();
  const p = f.pane(); f.layout(); const error = new Error("current vault read failed");
  f.scans[1].reject(error); await flush();
  assert.equal(f.plugin.prefs.mode, "2d"); assert.deepEqual(f.plugin.saved, { mode: "2d" });
  assert.deepEqual(f.saves, saved === "2d" ? [{ mode: "3d" }, { mode: "2d" }] : [{ mode: "2d" }]);
  assert.equal(f.scenes.length, 1); assert.equal(f.scenes[0].destroyed, 1);
  assert.equal(f.notices.length, 1); assert.equal(f.diagnostics.mock.callCount(), 1);
  assert.equal(f.diagnostics.mock.calls[0].arguments[1], error);
  for (const pane of [f.first, p]) assert.equal(f.controls(pane).two.getAttribute("aria-pressed"), "true");
  f.layout(); f.events.get("resolved")(); await flush(); assert.equal(f.scans.length, 2, "no automatic retry");
  f.controls(p).cube.click(); for (const scan of f.scans.slice(2)) scan.resolve(false); await flush();
  assert.equal(f.plugin.prefs.mode, "3d"); assert.equal(f.scenes.length, 3);
  assert.equal(f.scenes[1].shows, 1); assert.equal(f.scenes[2].plays, 1); assert.equal(f.notices.length, 1);
});

for (const outcome of ["resolve", "reject"]) {
  for (const boundary of ["unload", "2d", "reconciliation", "supersession"]) test(`${outcome} after ${boundary} preserves current request/lifecycle`, async t => {
    const f = await fixture(t);
    const pending = f.scans[0];
    if (boundary === "unload") f.plugin.onunload();
    if (boundary === "2d") f.controls(f.first).two.click();
    if (boundary === "reconciliation") { f.controls(f.first).toggle.remove(); f.layout(); }
    if (boundary === "supersession") { f.controls(f.first).cube.click(); f.events.get("resolved")(); }
    if (outcome === "reject") pending.reject(new Error("old request")); else pending.resolve(false);
    await flush(); assert.equal(f.scenes.length, 0); assert.equal(f.notices.length, 0);
    assert.equal(f.diagnostics.mock.callCount(), 0);
    assert.equal(f.plugin.prefs.mode, boundary === "2d" ? "2d" : "3d");
    assert.deepEqual(f.plugin.saved, { mode: boundary === "2d" ? "2d" : "3d" });
    if (["reconciliation", "supersession"].includes(boundary)) {
      assert.equal(f.scans.length, 2);
      if (boundary === "supersession") assert.equal(f.plugin.attached.get(f.first.view).loadingAnimation, true);
      f.scans[1].resolve(false); await flush(); assert.equal(f.scenes.length, 1);
      assert.equal(f.scenes[0].plays, boundary === "supersession" ? 1 : 0);
      assert.equal(f.scenes[0].shows, boundary === "reconciliation" ? 1 : 0);
    }
  });
}

for (const outcome of ["show", "play", "reject"]) test(`existing scene ignores pending ${outcome} after ownership loss before layout`, async t => {
  const f = await fixture(t); f.scans[0].resolve(false); await flush();
  const p = f.pane(); f.layout(); f.scans[1].resolve(false); await flush();
  const scene = f.scenes[1], a = f.plugin.attached.get(p.view);
  if (outcome === "play") f.controls(p).cube.click();
  else {
    // Changed real graph data ensures onlyChanged cannot mask a stale show.
    const extra = new TFile("Notes/two.md"); extra.stat = { ctime: new Date("2026-01-02T12:00:00").getTime() };
    const oldFiles = f.app.vault.getMarkdownFiles(); f.app.vault.getMarkdownFiles = () => [...oldFiles, extra];
    f.events.get("resolved")();
    // Refresh also started a scan for the independent current pane.
    f.scans[2].resolve(false); await flush();
  }
  const before = structuredClone(state(f)), shape = a.shape;
  f.setLeaves([f.first.leaf]);
  if (outcome === "reject") f.scans.at(-1).reject(new Error("obsolete refresh")); else f.scans.at(-1).resolve(false);
  await flush(); assert.deepEqual(state(f), before); assert.equal(a.shape, shape);
  assert.equal(scene.shows, 1); assert.equal(scene.plays, 0); assert.equal(scene.destroyed, 0);
  f.layout(); assert.equal(scene.destroyed, 1); assert.equal(f.scenes[0].destroyed, 0);
});

for (const outcome of ["resolve", "reject"]) test(`older scan ${outcome} after newer playback completes cannot replace or stop it`, async t => {
  const f = await fixture(t); f.controls(f.first).cube.click();
  f.scans[1].resolve(false); await flush();
  assert.equal(f.scenes.length, 1); assert.equal(f.scenes[0].plays, 1);
  const before = structuredClone(state(f));
  if (outcome === "reject") f.scans[0].reject(new Error("superseded")); else f.scans[0].resolve(false);
  await flush(); assert.deepEqual(state(f), before); assert.equal(f.scenes[0].isRunning, true);
});

test("saved-3D initial scan failure is current after synchronous attachment finishes", async t => {
  const f = await fixture(t), error = new Error("startup scan failed");
  f.scans[0].reject(error); await flush();
  assert.equal(f.scenes.length, 0); assert.equal(f.plugin.prefs.mode, "2d");
  assert.deepEqual(f.plugin.saved, { mode: "2d" }); assert.deepEqual(f.saves, [{ mode: "2d" }]);
  assert.equal(f.notices.length, 1); assert.equal(f.diagnostics.mock.calls[0].arguments[1], error);
});
