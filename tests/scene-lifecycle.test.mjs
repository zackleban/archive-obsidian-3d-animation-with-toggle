import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import moment from "moment";
import { JSDOM } from "jsdom";
import { load } from "./helpers.mjs";

// Actual GraphScene and Three scene/math; only platform/resource boundaries are doubles.
async function fixture(failure = null, cleanupFailure = null) {
  const dom = new JSDOM('<main></main>');
  const { window } = dom;
  const { document, HTMLElement } = window;
  const state = { failure, cleanupFailure, calls: {}, opened: [], ended: 0, renderers: [], controls: [], observers: [], listeners: new Set(), frames: new Map(), timers: new Map(), callbacks: [] };
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
    else { element.className = options.cls ?? ""; element.textContent = options.text ?? ""; }
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
  const { GraphScene } = await load("src/scene.ts", { moment }, undefined, { three: { ...THREE, WebGLRenderer: Renderer }, "three/examples/jsm/controls/TrackballControls.js": { TrackballControls: Controls } });
  const parent = document.querySelector("main");
  return {
    state, injected, cleanupError, parent, window,
    create: () => new GraphScene(parent, { open(path) { state.opened.push(path); }, ended() { state.ended++; } }),
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
