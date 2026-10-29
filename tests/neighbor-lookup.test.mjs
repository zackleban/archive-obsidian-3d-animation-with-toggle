import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import moment from "moment";
import { load, TFile } from "./helpers.mjs";

// Actual load/show/play/grow/advance/place/destroy, real Three math/meshes.
// Constructor/platform/DOM and simulation integration are doubled. No native timing/FPS claim.
function force() {
  return { distance(v) { this.distanceValue = v; return this; }, strength(v) { this.strengthValue = v; return this; },
    distanceMax(v) { this.distanceMaxValue = v; return this; }, links(v) { this.linkValues = v; return this; } };
}
const d3 = {
  forceLink: force, forceManyBody: force, forceX: force, forceY: force, forceZ: force,
  forceSimulation(nodes, dimensions) {
    const forces = new Map();
    const sim = { dimensions, ticks: 0, stops: 0, alphaValue: 1, nodeValues: nodes,
      force(name, value) { if (arguments.length === 1) return forces.get(name); forces.set(name, value); return this; },
      stop() { this.stops++; return this; }, nodes(value) { this.nodeValues = value; return this; },
      alpha(value) { if (!arguments.length) return this.alphaValue; this.alphaValue = value; return this; },
      alphaMin() { return 0.001; }, tick() { this.ticks++; return this; } };
    return sim;
  },
};
const { GraphScene } = await load(process.env.GRAPH_SCENE_SOURCE ?? "src/scene.ts", { moment }, undefined, { three: THREE, "d3-force-3d": d3 });
const { buildGraph } = await load("src/vault-graph.ts", { moment });
const numeric = key => typeof key === "string" && /^(0|[1-9]\d*)$/.test(key);
function fixture(Scene = GraphScene) {
  const scene = Object.create(Scene.prototype);
  const counts = { loadLinks: 0, neighborLinks: 0, incidentEntries: 0, calls: 0 };
  let phase = "other", index;
  Object.defineProperty(scene, "neighbours", {
    get: () => index,
    set(value) { index = value.map(list => new Proxy(list, { get(target, key, receiver) {
      if (phase === "neighbor" && numeric(key)) counts.incidentEntries++;
      return Reflect.get(target, key, receiver);
    } })); },
  });
  const originalLoad = scene.load, originalNeighbor = scene.neighbourOf;
  scene.load = function(graph) { phase = "load"; try { return originalLoad.call(this, graph); } finally { phase = "other"; } };
  scene.neighbourOf = function(i) { counts.calls++; phase = "neighbor"; try { return originalNeighbor.call(this, i); } finally { phase = "other"; } };
  const win = { clearTimeout() {}, cancelAnimationFrame() {}, requestAnimationFrame() { return 1; } };
  Object.assign(scene, { graph: null, nodes: [], anchors: [], sim: null, alive: 0, aliveLinks: 0, bornAt: [],
    dots: null, lines: null, cleanups: [], destroyed: false, scene: new THREE.Scene(),
    el: { win }, camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3(), update() {} },
    renderer: { render() {} }, hooks: { ended() { scene.ended++; } }, ended: 0, lastFrame: 1000,
    release() {}, setHover() {}, cssColor: () => "#888888", drawLegend() {}, drawDay(day) { scene.day = day; }, stepZoom() {}, hovered: -1,
  });
  return { scene, counts, graph(graph) {
    return { ...graph, links: new Proxy(graph.links, { get(target, key, receiver) {
      if (numeric(key)) { if (phase === "load") counts.loadLinks++; if (phase === "neighbor") counts.neighborLinks++; }
      return Reflect.get(target, key, receiver);
    } }) };
  } };
}
function graphOf(days, links, groups = ["Synthetic"]) {
  const notes = days.map((day, i) => ({ path: `Synthetic/${i}.md`, name: `${i}`, day, group: i % groups.length, degree: 0 }));
  for (const [a, b] of links) { notes[a].degree++; notes[b].degree++; }
  return { notes, links, groups, days: Math.max(1, ...days), start: 0 };
}
function controlled(action) {
  const random = Math.random, now = performance.now;
  let seed = 123456789;
  Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  performance.now = () => 1000;
  try { return action(); } finally { Math.random = random; performance.now = now; }
}
function legacyNeighbor(i) {
  for (const [a, b] of this.graph.links) {
    const other = a === i ? b : b === i ? a : -1;
    if (other >= 0 && other < this.alive) return this.nodes[other];
  }
  return null;
}
function snapshot(scene) {
  scene.place(1000);
  return { nodes: structuredClone(scene.nodes), bornAt: [...scene.bornAt], alive: scene.alive,
    aliveLinks: scene.aliveLinks, dots: scene.dots.count, capacity: scene.dots.instanceMatrix.count,
    matrices: [...scene.dots.instanceMatrix.array], positions: [...scene.lines.geometry.getAttribute("position").array],
    drawRange: { ...scene.lines.geometry.drawRange }, links: structuredClone(scene.sim.force("link").linkValues),
    ticks: scene.sim.ticks, alpha: scene.sim.alpha(), running: scene.isRunning, runMs: scene.runMs };
}

for (const n of [100, 1000]) {
  for (const playback of [false, true]) {
    test(`bounded ${playback ? "ten-batch playback" : "initial show"}: ${n}-note chain`, t => {
      const f = fixture();
      const batch = n / 10;
      const graph = f.graph(graphOf(Array.from({ length: n }, (_, i) => Math.floor(i / batch) + 1),
        Array.from({ length: n - 1 }, (_, i) => [i, i + 1])));
      try {
        controlled(() => {
          if (playback) { f.scene.play(graph); for (let day = 2; day <= 10; day++) f.scene.grow(f.scene.countThrough(day), true); }
          else f.scene.show(graph);
        });
        t.diagnostic(JSON.stringify({ notes: n, links: n - 1, batches: playback ? 10 : 1, ...f.counts,
          storedEntries: f.scene.neighbours?.reduce((sum, list) => sum + list.length, 0) ?? 0 }));
        assert.equal(f.counts.calls, n);
        assert.ok(f.counts.neighborLinks + f.counts.incidentEntries <= 2 * (n - 1), "birth lookup visits at most the incident entries across one population");
        assert.equal(f.counts.loadLinks, n - 1, "one complete tuple pass at load");
        assert.equal(f.scene.neighbours.length, n);
        assert.equal(f.scene.neighbours.reduce((sum, list) => sum + list.length, 0), 2 * (n - 1));
        assert.equal(f.scene.aliveLinks, n - 1);
        assert.equal(f.scene.dots.count, n);
        assert.equal(f.scene.sim.ticks, playback ? 0 : 120);
      } finally { f.scene.destroy(); }
    });
  }
}

const mixed = graphOf([1, 1, 2, 2, 3, 3, 4, 4], [[1, 2], [2, 0], [2, 3], [4, 3], [4, 1], [5, 4], [6, 5]], ["A", "B"]);
for (const mode of ["show", "playback", "skipped days"]) {
  test(`${mode} exactly matches legacy placement, pop, link activation and drawing with deterministic input`, () => {
    const actual = fixture().scene, reference = fixture().scene;
    reference.neighbourOf = legacyNeighbor;
    function run(scene) {
      return controlled(() => {
        const states = [];
        if (mode === "show") { scene.show(mixed); states.push(snapshot(scene)); }
        else {
          scene.play(mixed); states.push(snapshot(scene));
          for (const day of mode === "skipped days" ? [3, 4] : [2, 3, 4]) {
            scene.grow(scene.countThrough(day), true); states.push(snapshot(scene));
          }
        }
        return states;
      });
    }
    try { assert.deepEqual(run(actual), run(reference)); }
    finally { actual.destroy(); reference.destroy(); }
  });
}

test("graph ordering and first eligible neighbor preserve metadata tie order and prior-batch eligibility", () => {
  const files = ["e", "c", "a", "d", "b"].map(name => {
    const f = new TFile(`Synthetic/${name}.md`); f.stat = { ctime: Date.UTC(2026, 0, name <= "b" ? 1 : name <= "d" ? 2 : 3) }; return f;
  });
  const graph = buildGraph({ vault: { getMarkdownFiles: () => files, getName: () => "Synthetic" }, metadataCache: { resolvedLinks: {
    "Synthetic/b.md": { "Synthetic/c.md": 1 }, "Synthetic/c.md": { "Synthetic/a.md": 1, "Synthetic/d.md": 1 },
    "Synthetic/d.md": { "Synthetic/e.md": 1 },
  } } }, []);
  assert.deepEqual(graph.notes.map(n => n.name), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(graph.links, [[1, 2], [2, 0], [2, 3], [3, 4]]);
  const scene = fixture().scene;
  try {
    controlled(() => scene.play(graph));
    assert.equal(scene.neighbourOf(2), scene.nodes[1], "first in link order, not smallest index");
    assert.equal(scene.neighbourOf(3), null, "same-day c is not alive in this batch");
    controlled(() => scene.grow(4, true));
    assert.equal(scene.neighbourOf(4), scene.nodes[3], "previous batch is eligible now");
    assert.equal(scene.sim.dimensions, 3);
    assert.equal(scene.sim.force("link").distanceValue, 30);
    assert.equal(scene.sim.force("link").strengthValue, 0.3);
    assert.equal(scene.sim.force("charge").strengthValue, -40);
    assert.equal(scene.sim.force("charge").distanceMaxValue, 600);
    for (const axis of ["x", "y", "z"]) assert.equal(scene.sim.force(axis).strengthValue, 0.06);
  } finally { scene.destroy(); }
});

test("replay and replacement release old indexes; destruction is inert and releases the current index", () => {
  const scene = fixture().scene;
  try {
    const first = controlled(() => { scene.play(mixed); return snapshot(scene); });
    const oldIndex = scene.neighbours, oldSim = scene.sim;
    controlled(() => scene.grow(8, true));
    const replay = controlled(() => { scene.play(mixed); return snapshot(scene); });
    assert.deepEqual(replay, first);
    assert.ok(oldSim.stops >= 2);
    assert.notEqual(scene.neighbours, oldIndex);
    const replacement = graphOf([1, 2], [], ["Isolated"]);
    controlled(() => scene.show(replacement));
    assert.deepEqual(scene.neighbours, [[], []]);
    assert.equal(scene.neighbourOf(1), null);
    assert.equal(scene.dots.count, 2);
    controlled(() => scene.show(graphOf([], [], [])));
    assert.deepEqual(scene.neighbours, []);
    assert.equal(scene.dots.count, 0);
    assert.equal(scene.dots.instanceMatrix.count, 1);
    controlled(() => scene.play(mixed));
    scene.destroy(); scene.destroy();
    assert.deepEqual(scene.neighbours, []);
    scene.show(mixed); scene.play(mixed);
    assert.deepEqual(scene.neighbours, []);
  } finally { scene.destroy(); }
});

test("scheduled playback retains one tick per frame, duration bounds, completion and visible-node bound", () => {
  const scene = fixture().scene;
  try {
    controlled(() => {
      scene.play(mixed);
      assert.equal(scene.runMs, 8000);
      scene.runStart = 1000 - 4000;
      scene.advance();
      assert.equal(scene.alive, 4); assert.equal(scene.sim.ticks, 1);
      scene.runStart = 1000 - 8000;
      scene.advance();
      assert.equal(scene.alive, 8); assert.equal(scene.dots.count, 8);
      assert.equal(scene.aliveLinks, 7); assert.equal(scene.sim.ticks, 2);
      assert.equal(scene.isRunning, false); assert.equal(scene.ended, 1);
      scene.advance(); assert.equal(scene.ended, 1); assert.equal(scene.sim.ticks, 3);
      scene.play(graphOf([1, 1000], [])); assert.equal(scene.runMs, 40000);
      scene.play(graphOf([1, 200], [])); assert.equal(scene.runMs, 12000);
    });
  } finally { scene.destroy(); }
});

// Separate dependency control: use installed d3-force-3d with its real mutations/ticks.
const { GraphScene: RealSimulationScene } = await load(process.env.GRAPH_SCENE_SOURCE ?? "src/scene.ts", { moment }, undefined, { three: THREE });
for (const playback of [false, true]) {
  test(`installed simulation matches legacy ${playback ? "playback" : "initial relaxation"}`, () => {
    const actual = fixture(RealSimulationScene).scene, reference = fixture(RealSimulationScene).scene;
    reference.neighbourOf = legacyNeighbor;
    const linksBefore = structuredClone(mixed.links);
    function run(scene) {
      return controlled(() => {
        const states = [];
        if (playback) {
          scene.play(mixed);
          for (const count of [4, 6, 8]) {
            scene.sim.tick(3); // Prior-batch positions have moved before the next birth.
            scene.grow(count, true);
            states.push(snapshot(scene));
          }
        } else { scene.show(mixed); states.push(snapshot(scene)); }
        assert.equal(scene.sim.numDimensions(), 3);
        assert.equal(scene.sim.force("link").links().length, mixed.links.length);
        for (const link of scene.sim.force("link").links()) {
          assert.equal(typeof link.source, "object"); assert.equal(typeof link.target, "object");
        }
        return states;
      });
    }
    try {
      assert.deepEqual(run(actual), run(reference));
      assert.deepEqual(mixed.links, linksBefore, "force-link endpoint mutation cannot change graph/index tuples");
    } finally { actual.destroy(); reference.destroy(); }
  });
}
