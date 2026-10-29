import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import * as force from "d3-force-3d";
import moment from "moment";
import { JSDOM } from "jsdom";
import { load } from "./helpers.mjs";

// Exercise the installed controls, including their window/document listeners.
// WebGLRenderer, ResizeObserver, animation scheduling and Obsidian DOM helpers are doubles.
async function fixture(failure = null) {
  const dom = new JSDOM("<main></main>");
  const { window } = dom;
  const { document, HTMLElement } = window;
  // Initialize JSDOM's selector engine before tracking resources owned by the scene.
  const parent = document.querySelector("main");
  const state = { failure, listeners: new Set(), renderers: [], observers: [], frames: new Map(), timers: new Map(), opened: [] };
  const injected = Error(`real controls ${failure}`);
  let nextFrame = 0;
  Object.defineProperty(HTMLElement.prototype, "win", { get: () => window });
  HTMLElement.prototype.createDiv = function(options) {
    const element = document.createElement("div");
    element.className = typeof options === "string" ? options : options?.cls ?? "";
    this.append(element);
    return element;
  };
  HTMLElement.prototype.createSpan = function(options) {
    const element = document.createElement("span");
    element.className = options?.cls ?? "";
    element.textContent = options?.text ?? "";
    this.append(element);
    return element;
  };
  HTMLElement.prototype.empty = function() { this.replaceChildren(); };
  HTMLElement.prototype.setText = function(text) { this.textContent = text; };
  HTMLElement.prototype.toggleClass = function(name, enabled) { this.classList.toggle(name, enabled); };
  HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
  HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
  window.requestAnimationFrame = (callback) => { const id = ++nextFrame; state.frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => state.frames.delete(id);
  window.setTimeout = (callback) => { const id = ++nextFrame; state.timers.set(id, callback); return id; };
  window.clearTimeout = (id) => state.timers.delete(id);

  function track(target, allowed = null) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, callback, options) => {
      if (!allowed || allowed.includes(type)) {
        if (![...state.listeners].some(entry => entry.target === target && entry.type === type && entry.callback === callback)) {
          state.listeners.add({ target, type, callback });
        }
      }
      add(type, callback, options);
      // Fail after registering to model a partially completed connect call.
      if (state.failure === "connect" && type === "wheel") throw injected;
    };
    target.removeEventListener = (type, callback, options) => {
      for (const entry of state.listeners) {
        if (entry.target === target && entry.type === type && entry.callback === callback) state.listeners.delete(entry);
      }
      remove(type, callback, options);
    };
  }
  track(window, ["keydown", "keyup"]);
  track(document, ["pointermove", "pointerup"]);
  class Renderer {
    constructor() {
      this.domElement = document.createElement("canvas");
      this.domElement.setPointerCapture = () => {};
      this.domElement.releasePointerCapture = () => {};
      this.domElement.getBoundingClientRect = () => {
        if (state.failure === "resize") throw injected;
        return { left: 0, top: 0, width: 640, height: 480 };
      };
      track(this.domElement);
      this.disposed = 0;
      this.contextLost = 0;
      state.renderers.push(this);
    }
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
    render() {}
    dispose() { this.disposed++; }
    forceContextLoss() { this.contextLost++; }
  }
  class Observer {
    constructor() { this.active = false; state.observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  globalThis.window = window;
  globalThis.ResizeObserver = Observer;
  const { GraphScene } = await load(process.env.SCENE_LIFECYCLE_SOURCE ?? "src/scene.ts", { moment }, undefined, {
    three: { ...THREE, WebGLRenderer: Renderer },
    "three/examples/jsm/controls/TrackballControls.js": { TrackballControls },
    "d3-force-3d": force,
  });
  return {
    state, injected, parent, window,
    create: () => new GraphScene(parent, { open(path) { state.opened.push(path); }, ended() {}, failed() {} }),
    fireTimers() {
      for (const [id, callback] of [...state.timers]) {
        state.timers.delete(id);
        callback();
      }
    },
    assertClean() {
      assert.equal(state.listeners.size, 0, `listeners left: ${[...state.listeners].map(entry => `${entry.type}:${entry.callback?.name}`).join(", ")}`);
      assert.equal(parent.children.length, 0, "overlay removed");
      assert.equal(state.frames.size, 0, "no scheduled frame");
      assert.equal(state.timers.size, 0, "no pending hold/open timer");
      assert.ok(state.observers.every(observer => !observer.active), "no active observer");
      for (const renderer of state.renderers) {
        assert.equal(renderer.disposed, 1, "renderer disposed once");
        assert.equal(renderer.contextLost, 1, "context released once");
      }
    },
    restore() {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
      if (previousObserver) Object.defineProperty(globalThis, "ResizeObserver", previousObserver); else delete globalThis.ResizeObserver;
      dom.window.close();
    },
  };
}

for (const stage of ["connect", "resize"]) {
  test(`actual TrackballControls ${stage} failure releases acquired listeners and renderer`, async () => {
    const f = await fixture(stage);
    try {
      assert.throws(f.create, error => error === f.injected);
      f.assertClean();
      f.state.failure = null;
      const recovered = f.create();
      recovered.destroy();
      recovered.destroy();
      f.assertClean();
    } finally { f.restore(); }
  });
}

test("actual TrackballControls teardown removes document listeners during an active drag", async () => {
  const f = await fixture();
  let scene;
  try {
    scene = f.create();
    const event = new f.window.MouseEvent("pointerdown", { button: 2, clientX: 10, clientY: 10 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
    f.state.renderers[0].domElement.dispatchEvent(event);
    assert.ok([...f.state.listeners].some(entry => entry.target === f.window.document && entry.type === "pointermove"));
    scene.destroy();
    scene.destroy();
    f.assertClean();
  } finally {
    scene?.destroy();
    f.restore();
  }
});

// Actual scene + installed controls/math/simulation; only hit selection, renderer,
// timers, pointer capture, observer and Obsidian DOM helpers are controlled.
const graph = {
  notes: [{ path: "Synthetic/Note.md", name: "Note", group: 0, degree: 0, day: 1 }],
  links: [], groups: ["Synthetic"], start: 0, days: 1,
};
async function gesture(t) {
  const f = await fixture();
  let scene;
  t.after(() => { try { scene?.destroy(); f.assertClean(); } finally { f.restore(); } });
  scene = f.create();
  scene.cssColor = () => "#888888"; // Theme resolution is outside the gesture contract.
  scene.show(graph);
  scene.rayAt = () => ({ intersectObject: () => [{ instanceId: 0, point: new THREE.Vector3() }] });
  const canvas = f.state.renderers[0].domElement;
  return {
    ...f, scene, canvas,
    pointer(type, x = 100, y = 100, button = 0) {
      const event = new f.window.MouseEvent(type, {
        bubbles: true, button, buttons: type === "pointerup" || type === "pointercancel" ? 0 : button === 2 ? 2 : 1,
        clientX: x, clientY: y,
      });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
      canvas.dispatchEvent(event);
    },
  };
}

for (const [dx, dy] of [[12, 0], [-12, 0], [0, 12], [3, 3]]) {
  test(`drag-return (${dx}, ${dy}) stays disqualified with installed controls`, async t => {
    const f = await gesture(t);
    f.pointer("pointerdown");
    f.pointer("pointermove", 100 + dx, 100 + dy);
    f.pointer("pointermove");
    f.pointer("pointerup");
    f.fireTimers();
    assert.deepEqual(f.state.opened, [], "returning to the press must not open a note");
    assert.equal(f.scene.el.classList.contains("is-grabbing"), false, "movement cancels the hold");
    // A new press resets eligibility; the repair must not permanently disable clicks.
    f.pointer("pointerdown");
    f.pointer("pointerup");
    assert.deepEqual(f.state.opened, [], "opening still waits for a possible double click");
    f.fireTimers();
    assert.deepEqual(f.state.opened, ["Synthetic/Note.md"]);
  });
}

for (const distance of [0, 4, 4.01, 12]) {
  test(`click distance ${distance} retains the existing threshold with installed controls`, async t => {
    const f = await gesture(t);
    f.pointer("pointerdown");
    // No move delivery: release position must still guard click eligibility.
    f.pointer("pointerup", 100 + distance);
    f.fireTimers();
    assert.deepEqual(f.state.opened, distance <= 4 ? ["Synthetic/Note.md"] : []);
  });
}

test("delivered threshold movement still clicks, while hold/slide/release does not", async t => {
  const f = await gesture(t);
  f.pointer("pointerdown");
  f.pointer("pointermove", 104);
  f.pointer("pointerup", 104);
  f.fireTimers();
  assert.deepEqual(f.state.opened, ["Synthetic/Note.md"]);
  f.state.opened.length = 0;
  f.pointer("pointerdown");
  f.fireTimers();
  assert.equal(f.scene.controls.noRotate, true);
  assert.equal(f.scene.el.classList.contains("is-grabbing"), true);
  f.pointer("pointermove", 112);
  f.pointer("pointermove");
  f.pointer("pointerup");
  f.fireTimers();
  assert.deepEqual(f.state.opened, []);
  assert.equal(f.scene.controls.noRotate, false);
  assert.equal(f.scene.el.classList.contains("is-grabbing"), false);
});

test("cancel and right-button return never open; fresh left click remains usable", async t => {
  const f = await gesture(t);
  f.pointer("pointerdown");
  f.pointer("pointercancel");
  f.pointer("pointerup");
  f.fireTimers();
  f.pointer("pointerdown", 100, 100, 2);
  f.pointer("pointermove", 112, 100, 2);
  f.pointer("pointermove", 100, 100, 2);
  f.pointer("pointerup", 100, 100, 2);
  f.fireTimers();
  assert.deepEqual(f.state.opened, []);
  f.pointer("pointerdown");
  f.pointer("pointerup");
  f.fireTimers();
  assert.deepEqual(f.state.opened, ["Synthetic/Note.md"]);
});

test("refresh/play reset presses and pending opens; double-click still cancels opening", async t => {
  const f = await gesture(t);
  for (const mode of ["show", "play"]) {
    f.pointer("pointerdown");
    f.scene[mode](graph);
    f.pointer("pointerup");
    f.fireTimers();
    assert.deepEqual(f.state.opened, []);
    f.pointer("pointerdown");
    f.pointer("pointerup");
    f.scene[mode](graph);
    f.fireTimers();
    assert.deepEqual(f.state.opened, []);
  }
  f.pointer("pointerdown");
  f.pointer("pointerup");
  f.canvas.dispatchEvent(new f.window.MouseEvent("dblclick", { clientX: 100, clientY: 100 }));
  f.fireTimers();
  assert.deepEqual(f.state.opened, []);
  assert.ok(f.scene.zoom, "double-click still starts its zoom");
});

test("destroy retires pending opens and retained callbacks after pointer interaction", async t => {
  const f = await gesture(t);
  f.pointer("pointerdown");
  f.pointer("pointerup");
  const retained = [...f.state.timers.values()];
  assert.equal(retained.length, 1);
  f.scene.destroy();
  f.assertClean();
  for (const callback of retained) callback();
  f.pointer("pointerdown");
  f.pointer("pointerup");
  f.fireTimers();
  assert.deepEqual(f.state.opened, []);
});
