import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import moment from "moment";
import { JSDOM } from "jsdom";
import { load, TFile, TFolder, notices } from "./helpers.mjs";

// Actual GraphScene and Three scene/math; only platform/resource boundaries are doubles.
async function fixture(failure = null, cleanupFailure = null) {
  const dom = new JSDOM('<main></main>');
  const { window } = dom;
  const { document, HTMLElement } = window;
  const state = { failure, cleanupFailure, calls: {}, opened: [], ended: 0, failures: [], renderers: [], controls: [], observers: [], listeners: new Set(), frames: new Map(), timers: new Map(), callbacks: [] };
  const injected = Error(`injected ${failure}`);
  const cleanupError = Error(`injected cleanup ${cleanupFailure}`);
  let sequence = 0;
  function call(stage) {
    state.calls[stage] = (state.calls[stage] ?? 0) + 1;
    if (state.failure === stage) throw injected;
    if (state.cleanupFailure === stage) throw cleanupError;
  }
  Object.defineProperty(HTMLElement.prototype, "win", { get() { return window; } });
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    call(`dom.create.${typeof options === "string" ? options : options.cls ?? tag}`);
    const element = document.createElement(tag);
    if (typeof options === "string") element.className = options;
    else { element.className = options.cls ?? ""; element.textContent = options.text ?? ""; for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value); }
    this.append(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function(options) { return this.createEl("div", options); };
  HTMLElement.prototype.createSpan = function(options) { return this.createEl("span", options); };
  HTMLElement.prototype.empty = function() { this.replaceChildren(); };
  HTMLElement.prototype.setText = function(text) { this.textContent = text; };
  HTMLElement.prototype.toggleClass = function(name, enabled) { this.classList.toggle(name, enabled); };
  HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
  HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
  window.requestAnimationFrame = (callback) => { call("requestAnimationFrame"); const id = ++sequence; state.frames.set(id, callback); state.callbacks.push(callback); return id; };
  window.cancelAnimationFrame = (id) => { state.frames.delete(id); call("cancelAnimationFrame"); };
  window.setTimeout = (callback) => { const id = ++sequence; state.timers.set(id, callback); return id; };
  window.clearTimeout = (id) => { state.timers.delete(id); call("clearTimeout"); };

  function trackEvents(target, prefix) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const records = new Map();
    target.addEventListener = (type, callback, options) => {
      let byType = records.get(type);
      if (!byType) records.set(type, byType = new Map());
      if (!byType.has(callback)) { const entry = { target, type, callback }; byType.set(callback, entry); state.listeners.add(entry); }
      add(type, callback, options);
      // Inject after mutation to prove the listener cleanup was registered in advance.
      call(`${prefix}.add.${type}`);
    };
    target.removeEventListener = (type, callback, options) => {
      const byType = records.get(type);
      if (byType) { state.listeners.delete(byType.get(callback)); byType.delete(callback); }
      remove(type, callback, options);
      call(`${prefix}.remove.${type}`);
    };
  }
  class Renderer {
    constructor() {
      // A constructor that throws before returning has not transferred ownership.
      call("renderer.constructor");
      this.domElement = document.createElement("canvas");
      trackEvents(this.domElement, "canvas");
      this.disposed = 0; this.contextLost = 0;
      state.renderers.push(this);
    }
    setPixelRatio() { call("renderer.setPixelRatio"); }
    setClearColor() { call("renderer.setClearColor"); }
    setSize() { call("renderer.setSize"); }
    render() { call("renderer.render"); }
    dispose() { this.disposed++; call("renderer.dispose"); }
    forceContextLoss() { this.contextLost++; call("renderer.forceContextLoss"); }
  }
  class Controls extends THREE.EventDispatcher {
    constructor(camera, canvas) {
      super();
      call("controls.constructor");
      this.target = new THREE.Vector3(); this.domElement = null; this.disposed = 0;
      this.pointer = () => {};
      trackEvents(this, "controls");
      state.controls.push(this);
      if (canvas) this.connect(canvas);
    }
    connect(canvas) { this.domElement = canvas; canvas.addEventListener("controls-pointer", this.pointer); call("controls.connect"); }
    set rotateSpeed(value) { call("controls.rotateSpeed"); }
    set dynamicDampingFactor(value) { call("controls.dynamicDampingFactor"); }
    handleResize() { call("controls.handleResize"); }
    update() { call("controls.update"); }
    dispose() { this.disposed++; this.domElement?.removeEventListener("controls-pointer", this.pointer); call("controls.dispose"); }
  }
  class Observer {
    constructor(callback) { call("observer.constructor"); this.callback = callback; this.active = false; this.disconnected = 0; state.observers.push(this); }
    observe() { this.active = true; call("observer.observe"); }
    disconnect() { this.active = false; this.disconnected++; call("observer.disconnect"); }
  }
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  globalThis.ResizeObserver = Observer;
  const dependencies = { three: { ...THREE, WebGLRenderer: Renderer }, "three/examples/jsm/controls/TrackballControls.js": { TrackballControls: Controls } };
  const { GraphScene } = await load("src/scene.ts", { moment }, undefined, dependencies);
  const parent = document.querySelector("main");
  return {
    state, injected, cleanupError, parent, window,
    create: (hooks = {}) => new GraphScene(parent, { open(path) { state.opened.push(path); }, ended() { state.ended++; }, failed(scene, error) { state.failures.push({ scene, error }); }, ...hooks }),
    loadPlugin: (extra = {}) => load("src/main.ts", { moment, ...extra }, undefined, dependencies),
    frame() { const [id, callback] = state.frames.entries().next().value; state.frames.delete(id); callback(); return callback; },
    restore() { if (previousObserver) Object.defineProperty(globalThis, "ResizeObserver", previousObserver); else delete globalThis.ResizeObserver; window.close(); },
  };
}
function assertReleased(f) {
  const counts = {
    overlays: f.parent.querySelectorAll(".three-d-overlay").length,
    renderers: f.state.renderers.filter(r => r.disposed !== 1).length,
    contexts: f.state.renderers.filter(r => r.contextLost !== 1).length,
    controls: f.state.controls.filter(c => c.disposed !== 1).length,
    observers: f.state.observers.filter(o => o.active || o.disconnected !== 1).length,
    listeners: f.state.listeners.size,
    frames: f.state.frames.size,
    timers: f.state.timers.size,
  };
  assert.deepEqual(counts, { overlays: 0, renderers: 0, contexts: 0, controls: 0, observers: 0, listeners: 0, frames: 0, timers: 0 });
}

test("actual GraphScene releases a renderer when clear-color configuration fails", async () => {
  const f = await fixture("renderer.setClearColor");
  try {
    assert.throws(f.create, error => error === f.injected);
    assert.equal(f.state.renderers.length, 1);
    assertReleased(f);
  } finally { f.restore(); }
});

const failureStages = [
  "dom.create.three-d-canvas", "dom.create.three-d-tip",
  "renderer.constructor", "renderer.setPixelRatio",
  "controls.constructor", "controls.connect", "controls.rotateSpeed", "controls.dynamicDampingFactor", "controls.add.start",
  "canvas.add.pointermove", "canvas.add.pointerup", "canvas.add.dblclick",
  "observer.constructor", "observer.observe", "renderer.setSize", "controls.handleResize",
  "requestAnimationFrame", "controls.update", "renderer.render",
];
for (const stage of failureStages) {
  test(`actual GraphScene unwinds ${stage} failure and allows a successful retry`, async () => {
    const f = await fixture(stage);
    try {
      assert.throws(f.create, error => error === f.injected);
      assert.equal(f.state.calls[stage], 1, "the injection stage was reached");
      assert.deepEqual(f.state.failures, [], "constructor errors propagate without a scheduled-failure notification");
      assertReleased(f);
      f.state.failure = null;
      const retry = f.create();
      assert.equal(f.parent.querySelectorAll(".three-d-overlay").length, 1);
      assert.equal(f.state.frames.size, 1);
      retry.destroy();
      retry.destroy();
      assertReleased(f);
    } finally { f.restore(); }
  });
}

test("actual GraphScene cancels pending work, ignores stale callbacks, and destroys only once", async () => {
  const f = await fixture();
  try {
    const scene = f.create();
    const canvas = f.state.renderers[0].domElement;
    canvas.dispatchEvent(new f.window.MouseEvent("pointerdown", { button: 0, clientX: 3, clientY: 4 }));
    assert.equal(f.state.timers.size, 1, "a real scene pointer handler scheduled its hold timer");
    const delayedHold = [...f.state.timers.values()][0];
    // Supply only the hit result: the actual pointer-up handler schedules its open timer.
    scene.dots = {};
    scene.graph = { notes: [{ path: "Synthetic.md" }] };
    scene.rayAt = () => ({ intersectObject: () => [{ instanceId: 0 }] });
    canvas.dispatchEvent(new f.window.MouseEvent("pointerup", { button: 0, clientX: 3, clientY: 4 }));
    assert.equal(f.state.timers.size, 1);
    const delayedOpen = [...f.state.timers.values()][0];
    scene.dots = null;
    scene.graph = null;
    const oldFrame = [...f.state.frames.values()][0];
    const oldResize = f.state.observers[0].callback;
    scene.destroy();
    assertReleased(f);
    const calls = { ...f.state.calls };
    oldFrame(); oldResize(); delayedHold(); delayedOpen();
    canvas.dispatchEvent(new f.window.MouseEvent("pointerdown", { button: 0 }));
    scene.show({}); scene.play({}); scene.recolor();
    scene.destroy();
    assertReleased(f);
    assert.deepEqual(f.state.calls, calls, "stale callbacks and repeated cleanup must not touch resources");
    assert.equal(scene.el.classList.contains("is-grabbing"), false);
    assert.deepEqual(f.state.opened, [], "a stale click timer cannot open a note after teardown");
  } finally { f.restore(); }
});

for (const stage of ["observer.disconnect", "controls.dispose", "renderer.dispose", "renderer.forceContextLoss"]) {
  test(`cleanup continues after ${stage} throws without replacing the initialization error`, async () => {
    const f = await fixture("renderer.render", stage);
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args);
    try {
      assert.throws(f.create, error => error === f.injected);
      assertReleased(f);
      assert.ok(logs.flat().includes(f.cleanupError), "cleanup failure remains available for diagnosis");
    } finally { console.error = originalError; f.restore(); }
  });
}

test("ordinary destroy attempts all cleanup after a dependency throws and remains repeatable", async () => {
  const f = await fixture(null, "controls.dispose");
  const originalError = console.error;
  console.error = () => {};
  try {
    const scene = f.create();
    assert.doesNotThrow(() => scene.destroy());
    assert.doesNotThrow(() => scene.destroy());
    assertReleased(f);
  } finally { console.error = originalError; f.restore(); }
});

for (const throwOnGeometryDispose of [false, true]) {
  test(`destroy releases loaded real Three meshes and stops simulation${throwOnGeometryDispose ? " even if geometry disposal throws" : ""}`, async () => {
    const f = await fixture();
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args);
    try {
      const scene = f.create();
      // Real GraphScene.load(), Three geometry/materials and d3 simulation; empty synthetic graph.
      // JSDOM does not resolve Obsidian's theme CSS variables.
      f.window.getComputedStyle = () => ({ color: "rgb(136, 136, 136)" });
      scene.show({ groups: [], notes: [], links: [], days: 1, start: Date.now() });
      const meshes = [scene.dots, scene.lines];
      const resources = meshes.flatMap(mesh => [mesh.geometry, mesh.material]);
      const disposals = new Map(resources.map(resource => [resource, 0]));
      const disposalError = Error("injected real geometry dispose listener");
      for (const resource of resources) {
        resource.addEventListener("dispose", () => {
          disposals.set(resource, disposals.get(resource) + 1);
          if (throwOnGeometryDispose && resource === resources[0]) throw disposalError;
        });
      }
      const simulation = scene.sim;
      const stop = simulation.stop.bind(simulation);
      let stopped = 0;
      simulation.stop = () => { stopped++; return stop(); };
      scene.destroy();
      scene.destroy();
      assertReleased(f);
      assert.equal(stopped, 1);
      assert.deepEqual([...disposals.values()], [1, 1, 1, 1]);
      assert.ok(meshes.every(mesh => !scene.scene.children.includes(mesh)));
      assert.equal(scene.dots, null);
      assert.equal(scene.lines, null);
      if (throwOnGeometryDispose) assert.ok(logs.flat().includes(disposalError));
    } finally { console.error = originalError; f.restore(); }
  });
}


const syntheticGraph = () => ({ groups: ["Synthetic"], notes: [
  { path: "Synthetic/one.md", name: "one", group: 0, day: 1, degree: 1 },
  { path: "Synthetic/two.md", name: "two", group: 0, day: 2, degree: 1 },
], links: [[0, 1]], days: 2, start: Date.now() });

for (const stage of ["controls.update", "renderer.render"]) {
  test(`scheduled frame contains ${stage} after successful setup and releases loaded resources`, async () => {
    const f = await fixture();
    let scene, retry;
    try {
      f.window.getComputedStyle = () => ({ color: "rgb(136, 136, 136)" });
      scene = f.create();
      scene.show(syntheticGraph());
      f.frame(); // A successful queued frame, beyond the constructor's synchronous invocation.
      const resources = [scene.dots.geometry, scene.dots.material, scene.lines.geometry, scene.lines.material];
      const disposed = [];
      for (const resource of resources) resource.addEventListener("dispose", () => disposed.push(resource));
      const sim = scene.sim;
      const stop = sim.stop.bind(sim);
      let stopped = 0;
      sim.stop = () => { stopped++; return stop(); };
      const canvas = f.state.renderers[0].domElement;
      scene.rayAt = () => ({ intersectObject: () => [{ instanceId: 0 }] });
      canvas.dispatchEvent(new f.window.MouseEvent("pointerdown", { button: 0 }));
      canvas.dispatchEvent(new f.window.MouseEvent("pointerup", { button: 0 }));
      canvas.dispatchEvent(new f.window.MouseEvent("pointerdown", { button: 0 }));
      const timers = [...f.state.timers.values()];
      assert.equal(timers.length, 2);
      const oldFrame = [...f.state.frames.values()][0];
      f.state.failure = stage;
      // Capture baseline leakage before asserting exception containment.
      let escaped;
      try { f.frame(); } catch (error) { escaped = error; }
      assertReleased(f);
      assert.equal(escaped, undefined);
      assert.deepEqual(f.state.failures, [{ scene, error: f.injected }]);
      assert.equal(stopped, 1);
      assert.deepEqual(disposed, resources);
      const calls = { ...f.state.calls };
      oldFrame(); oldFrame(); timers.forEach(callback => callback()); f.state.observers[0].callback();
      scene.destroy(); scene.show(syntheticGraph()); scene.play(syntheticGraph());
      assert.deepEqual(f.state.calls, calls);
      assert.equal(f.state.failures.length, 1);
      assert.deepEqual(f.state.opened, []);
      f.state.failure = null;
      retry = f.create();
      retry.play(syntheticGraph()); f.frame();
      assert.equal(retry.isRunning, true);
      retry.destroy();
      assertReleased(f);
    } finally { retry?.destroy(); scene?.destroy(); f.restore(); }
  });
}

const flush = () => new Promise(resolve => setImmediate(resolve));
async function pluginFixture(extra = {}) {
  const f = await fixture();
  f.window.getComputedStyle = () => ({ color: "rgb(136, 136, 136)" });
  const { default: Plugin } = await f.loadPlugin(extra);
  const file = new TFile("Synthetic/one.md"); file.stat = { ctime: Date.now() };
  const events = new Map();
  const app = {
    vault: { getMarkdownFiles: () => [file], getName: () => "Synthetic", getRoot: () => ({ children: [] }), getAllFolders: () => [], configDir: ".obsidian", adapter: { exists: async () => false }, on: (name, fn) => { events.set(name, fn); return {}; } },
    metadataCache: { resolvedLinks: {}, on: (name, fn) => { events.set(name, fn); return {}; } },
    workspace: { getLeavesOfType: () => views.map(view => ({ view })), on: (name, fn) => { events.set(name, fn); return {}; }, onLayoutReady: fn => fn(), openLinkText: async () => {} },
  };
  const views = [0, 1].map(() => {
    const containerEl = f.parent.createDiv();
    containerEl.innerHTML = '<div class="view-content"><div class="core-2d">Core graph</div><div class="graph-controls"><button class="graph-controls-button mod-animate"></button></div></div>';
    return { containerEl };
  });
  const plugin = new Plugin(app);
  await plugin.onload();
  return { ...f, app, plugin, views, events };
}

test("actual plugin and scene restore 2D once after a scheduled failure; pending scans cannot retry", async () => {
  const f = await pluginFixture();
  const log = console.error, logs = []; console.error = (...args) => logs.push(args);
  const noticeStart = notices.length;
  try {
    f.plugin.setMode("3d"); await flush();
    const attached = [...f.plugin.attached.values()];
    const old = attached[0].scene;
    assert.ok(old?.dots, "actual scene has loaded graph meshes");
    const oldFrame = [...f.state.frames.values()][0];
    const releases = [];
    f.app.vault.getAllFolders = () => [new TFolder("Slow")];
    f.app.vault.adapter.exists = () => new Promise(resolve => releases.push(resolve));
    f.events.get("resolved")(); // pending idle refreshes in both panes
    const play = f.plugin.render(f.views[0], attached[0], true); // pending animation supersedes one refresh
    assert.equal(releases.length, 3);
    f.state.failure = "renderer.render";
    let escaped;
    try { f.frame(); } catch (error) { escaped = error; }
    assert.equal(f.plugin.prefs.mode, "2d");
    assert.equal(escaped, undefined);
    assertReleased(f);
    assert.equal(notices.length - noticeStart, 1);
    assert.equal(logs.filter(args => args.includes(f.injected)).length, 1);
    assert.equal(f.plugin.saved.mode, "2d");
    for (const a of attached) {
      assert.equal(a.scene, null); assert.equal(a.loadingAnimation, false);
      assert.equal(a.button.classList.contains("is-running"), false);
      assert.equal(a.toggle.querySelector('[data-mode="2d"]').getAttribute("aria-pressed"), "true");
    }
    assert.equal(f.parent.querySelectorAll(".core-2d").length, 2);
    releases.forEach(resolve => resolve(false)); await play; await flush();
    f.events.get("resolved")(); f.events.get("layout-change")(); oldFrame(); oldFrame();
    assertReleased(f);
    assert.equal(notices.length - noticeStart, 1);
    f.state.failure = null;
    f.app.vault.getAllFolders = () => [];
    attached[0].button.click(); await flush(); // deliberate user retry with playback
    const replacement = attached[0].scene;
    assert.ok(replacement && replacement !== old);
    assert.equal(replacement.isRunning, true);
    old.hooks.failed?.(old, Error("stale old scene failure")); oldFrame();
    assert.equal(attached[0].scene, replacement);
    assert.equal(f.plugin.prefs.mode, "3d");
    assert.equal(notices.length - noticeStart, 1);
    f.frame();
    const currentFrame = [...f.state.frames.values()][0];
    const sibling = attached[1].scene;
    f.plugin.detach(attached[0]);
    replacement.hooks.failed(replacement, Error("failure after detach")); currentFrame();
    assert.equal(attached[1].scene, sibling);
    assert.equal(f.plugin.prefs.mode, "3d");
    f.plugin.onunload(); f.plugin.onunload();
    sibling.hooks.failed(sibling, Error("failure after unload")); currentFrame();
    f.events.get("resolved")(); f.events.get("layout-change")(); await flush();
    assertReleased(f);
    assert.equal(notices.length - noticeStart, 1);
  } finally { f.plugin.onunload(); console.error = log; f.restore(); }
});


test("scheduled failure releases resources even when cleanup, failure hook and diagnostics throw", async () => {
  const f = await fixture();
  let scene;
  const log = console.error;
  const reported = [];
  let releaseError;
  try {
    scene = f.create({ failed(failedScene, error) {
      reported.push({ scene: failedScene, error });
      // Assert outside the intentionally contained hook, so production cannot swallow a test failure.
      try { assertReleased(f); } catch (error) { releaseError = error; }
      scene.destroy(); // Reentrant teardown must be harmless.
      throw Error("failure hook rejected");
    } });
    const retained = [...f.state.frames.values()][0];
    f.state.failure = "controls.update";
    f.state.cleanupFailure = "controls.dispose"; // Releases its listeners, then throws.
    console.error = () => { throw Error("logger rejected"); };
    assert.doesNotThrow(() => f.frame());
    assertReleased(f);
    retained(); retained(); scene.destroy();
    assert.deepEqual(reported, [{ scene, error: f.injected }]);
    assert.equal(releaseError, undefined, "release completes before reporting");
  } finally { console.error = log; scene?.destroy(); f.restore(); }
});

for (const failingChannel of ["console", "notice", "both"]) {
  test(`actual plugin frame fallback survives ${failingChannel} reporting failure and a cleanup exception`, async () => {
    let noticeAttempts = 0;
    const f = await pluginFixture({ Notice: class { constructor() {
      noticeAttempts++;
      if (failingChannel !== "console") throw Error("notice unavailable");
    } } });
    const log = console.error, logs = [];
    console.error = (...args) => {
      logs.push(args);
      if (failingChannel !== "notice") throw Error("console unavailable");
    };
    try {
      f.plugin.setMode("3d"); await flush();
      const retained = [...f.state.frames.values()];
      f.state.failure = "renderer.render";
      f.state.cleanupFailure = "observer.disconnect";
      assert.doesNotThrow(() => f.frame());
      assertReleased(f);
      assert.equal(f.plugin.prefs.mode, "2d");
      assert.equal(f.plugin.saved.mode, "2d");
      assert.equal(noticeAttempts, 1);
      assert.equal(logs.filter(args => args.includes(f.injected)).length, 1);
      assert.equal(logs.filter(args => args.includes(f.cleanupError)).length, 2);
      retained.forEach(callback => callback()); f.events.get("resolved")(); await flush();
      assertReleased(f);
      assert.equal(noticeAttempts, 1);
    } finally { f.plugin.onunload(); console.error = log; f.restore(); }
  });
}
