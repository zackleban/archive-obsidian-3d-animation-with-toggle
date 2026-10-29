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
  const state = { failure, listeners: new Set(), renderers: [], observers: [], frames: new Map() };
  const injected = Error(`real controls ${failure}`);
  let nextFrame = 0;
  Object.defineProperty(HTMLElement.prototype, "win", { get: () => window });
  HTMLElement.prototype.createDiv = function(options) {
    const element = document.createElement("div");
    element.className = typeof options === "string" ? options : options?.cls ?? "";
    this.append(element);
    return element;
  };
  HTMLElement.prototype.toggleClass = function(name, enabled) { this.classList.toggle(name, enabled); };
  HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
  HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
  window.requestAnimationFrame = (callback) => { const id = ++nextFrame; state.frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => state.frames.delete(id);

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
    create: () => new GraphScene(parent, { open() {}, ended() {} }),
    assertClean() {
      assert.equal(state.listeners.size, 0, `listeners left: ${[...state.listeners].map(entry => `${entry.type}:${entry.callback?.name}`).join(", ")}`);
      assert.equal(parent.children.length, 0, "overlay removed");
      assert.equal(state.frames.size, 0, "no scheduled frame");
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
