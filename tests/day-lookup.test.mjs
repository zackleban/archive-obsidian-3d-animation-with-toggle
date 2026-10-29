import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import moment from "moment";
import { load, TFile } from "./helpers.mjs";

const { GraphScene } = await load(process.env.GRAPH_SCENE_SOURCE ?? "src/scene.ts", { moment }, undefined, { three: THREE });
const { buildGraph } = await load("src/vault-graph.ts", { moment });

// Count only day reads performed by actual countThrough; fixture/expectation work is outside.
function lookup(days) {
  let reads = 0;
  const notes = days.map(day => ({ get day() { reads++; return day; } }));
  const scene = Object.assign(Object.create(GraphScene.prototype), { graph: { notes } });
  return { query(day) { reads = 0; const count = scene.countThrough(day); return { count, reads }; } };
}
const bound = n => n === 0 ? 0 : Math.floor(Math.log2(n)) + 1;
for (const n of [1000, 10000]) {
  test(`creation-day work is bounded per query: ${n} notes, 100 days, 2400 frames`, t => {
    const days = Array.from({ length: n }, (_, i) => Math.floor(i / (n / 100)) + 1);
    const queries = Array.from({ length: 2400 }, (_, frame) => Math.max(1, Math.ceil(frame / 2399 * 100)));
    const expected = queries.map(day => days.filter(value => value <= day).length);
    const measured = lookup(days);
    const results = queries.map(day => measured.query(day));
    assert.deepEqual(results.map(result => result.count), expected);
    const totalReads = results.reduce((sum, result) => sum + result.reads, 0);
    const maxReads = Math.max(...results.map(result => result.reads));
    t.diagnostic(JSON.stringify({ notes: n, days: 100, queries: queries.length, totalReads, maxReads, perQueryBound: bound(n), exactCounts: true }));
    assert.ok(results.every(result => result.reads <= bound(n)), "every query is logarithmically bounded, including repeated no-birth frames");
  });
}

for (const [name, days] of [
  ["empty", []], ["singleton", [1]], ["same day", Array(37).fill(1)],
  ["gapped batches", [1, 1, 3, 3, 3, 100, 1000]],
  ["finite extremes", [1, 2, 200000001]],
]) {
  test(`${name}: exact finite boundaries, fractional, repeated and backward queries`, () => {
    const queries = [-Number.MAX_VALUE, 0, 0.5, 1, 1.5, 2, 2.999, 3, 3, 3.001,
      99.5, 100, 1000, 200000001, Number.MAX_VALUE, ...days.flatMap(day => [day + 0.5, day, day - 0.5])];
    const expected = queries.map(day => days.filter(value => value <= day).length);
    const measured = lookup(days);
    assert.deepEqual(queries.map(day => measured.query(day).count), expected);
  });
}

function builtGraph() {
  const data = [["z", 10], ["d", 3], ["b", 1], ["c", 3], ["a", 1], ["e", 7]];
  const files = data.map(([name, day]) => {
    const file = new TFile(`Synthetic/${name}.md`);
    file.stat = { ctime: new Date(2026, 0, day, 12).getTime() };
    return file;
  });
  return buildGraph({ vault: { getMarkdownFiles: () => files, getName: () => "Synthetic" }, metadataCache: { resolvedLinks: {
    "Synthetic/b.md": { "Synthetic/c.md": 1 }, "Synthetic/c.md": { "Synthetic/a.md": 1, "Synthetic/d.md": 1 },
    "Synthetic/d.md": { "Synthetic/e.md": 1 }, "Synthetic/e.md": { "Synthetic/z.md": 1 },
  } } }, []);
}
test("actual buildGraph supplies day/path ordering without scene reordering", () => {
  const graph = builtGraph();
  assert.deepEqual(graph.notes.map(note => [note.name, note.day]), [["a", 1], ["b", 1], ["c", 3], ["d", 3], ["e", 7], ["z", 10]]);
  assert.deepEqual(graph.links, [[1, 2], [2, 0], [2, 3], [3, 4], [4, 5]]);
  assert.equal(graph.days, 10);
  const before = structuredClone(graph);
  const scene = Object.assign(Object.create(GraphScene.prototype), { graph });
  for (const day of [10, 3, 2, 1, 7, 0]) assert.equal(scene.countThrough(day), graph.notes.filter(note => note.day <= day).length);
  assert.deepEqual(graph, before);
});

// Real scene methods, Three meshes/math and installed d3 simulation. Constructor, UI,
// rendering, controls and frame delivery are doubled; performance.now/random are controlled.
function fixture() {
  const scene = Object.create(GraphScene.prototype);
  const frames = new Map();
  let id = 0;
  Object.assign(scene, {
    graph: null, nodes: [], anchors: [], neighbours: [], sim: null, alive: 0, aliveLinks: 0, bornAt: [],
    dots: null, lines: null, cleanups: [], destroyed: false, scene: new THREE.Scene(),
    el: { win: { clearTimeout() {}, cancelAnimationFrame(key) { frames.delete(key); }, requestAnimationFrame(fn) { frames.set(++id, fn); return id; } } },
    camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3(), update() { scene.updates++; } },
    renderer: { render() { scene.renders++; } }, hooks: { ended() { scene.ended++; } }, ended: 0, renders: 0, updates: 0, lastFrame: 1000,
    release() {}, setHover() {}, cssColor: () => "#888888", drawLegend() {}, hovered: -1,
    dayEl: { textContent: "", writes: 0, setText(text) { this.textContent = text; this.writes++; } },
  });
  // Deliver actual advance directly with a finite scheduler; existing lifecycle tests own loop/error coverage.
  scene.loop = () => scene.advance();
  return { scene, frame() { frames.delete(scene.frame); scene.advance(); }, frames };
}
function legacyCount(day) {
  const notes = this.graph.notes;
  let n = 0;
  while (n < notes.length && notes[n].day <= day) n++;
  return n;
}
function clocked(action) {
  const now = performance.now, random = Math.random;
  let time = 1000, seed = 123456789;
  performance.now = () => time;
  Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  try { return action(value => { time = value; }); }
  finally { performance.now = now; Math.random = random; }
}
function snapshot(scene) {
  return { alive: scene.alive, bornAt: [...scene.bornAt], nodes: structuredClone(scene.nodes),
    aliveLinks: scene.aliveLinks, links: scene.sim.force("link").links().map(link => [link.source.index, link.target.index]),
    dots: scene.dots.count, capacity: scene.dots.instanceMatrix.count,
    matrices: [...scene.dots.instanceMatrix.array], positions: [...scene.lines.geometry.getAttribute("position").array],
    drawRange: { ...scene.lines.geometry.drawRange }, label: scene.dayEl.textContent, labelWrites: scene.dayEl.writes,
    running: scene.isRunning, spinning: scene.spinning, runMs: scene.runMs, ended: scene.ended,
    renders: scene.renders, updates: scene.updates, alpha: scene.sim.alpha(), camera: scene.camera.position.toArray(), target: scene.controls.target.toArray() };
}
for (const skip of [false, true]) {
  test(`actual playback ${skip ? "skipped-day" : "ordinary"} batches exactly match legacy cutoffs`, () => {
    const graph = builtGraph(), before = structuredClone(graph);
    const actual = fixture(), reference = fixture();
    reference.scene.countThrough = legacyCount;
    const fractions = skip ? [0, 0.01, 0.01, 0.7, 0.7, 1, 1.1] : [0, 0.01, 0.01, 0.2, 0.3, 0.3, 0.6, 0.7, 1, 1.1];
    function run(f) {
      return clocked(setTime => {
        const scene = f.scene;
        scene.play(graph);
        assert.equal(scene.alive, 2); assert.equal(scene.runMs, 8000);
        const states = [], batches = [], eligible = [];
        const grow = scene.grow, neighbourOf = scene.neighbourOf;
        scene.grow = function(count, pop) {
          const prior = this.alive;
          grow.call(this, count, pop);
          if (count > prior) batches.push([prior, count, [...this.bornAt.slice(prior)]]);
        };
        scene.neighbourOf = function(i) { eligible.push([i, this.alive]); return neighbourOf.call(this, i); };
        for (const fraction of fractions) {
          setTime(1000 + fraction * 8000); f.frame();
          const day = Math.max(1, Math.ceil(Math.min(1, fraction) * graph.days));
          assert.equal(scene.alive, graph.notes.filter(note => note.day <= day).length);
          assert.equal(scene.dayEl.textContent, `Day ${day} of 10 · ${moment(graph.start).add(day - 1, "days").format("MMM D, YYYY")} · ${scene.alive} notes`);
          assert.equal(scene.aliveLinks, graph.links.filter(([a, b]) => a < scene.alive && b < scene.alive).length);
          assert.equal(scene.dots.count, scene.alive);
          assert.equal(f.frames.size, 1);
          states.push(snapshot(scene));
        }
        assert.equal(scene.ended, 1); assert.equal(scene.isRunning, false);
        assert.equal(scene.renders, fractions.length); assert.equal(scene.updates, fractions.length);
        assert.deepEqual(batches.map(([from, to]) => [from, to]), skip ? [[2, 5], [5, 6]] : [[2, 4], [4, 5], [5, 6]]);
        assert.deepEqual(eligible, skip ? [[2, 2], [3, 2], [4, 2], [5, 5]] : [[2, 2], [3, 2], [4, 4], [5, 5]]);
        for (const [, , times] of batches) assert.ok(times.every(time => time === times[0]), "one timestamp per birth batch");
        return { states, batches, eligible };
      });
    }
    try { assert.deepEqual(run(actual), run(reference)); assert.deepEqual(graph, before); }
    finally { actual.scene.destroy(); reference.scene.destroy(); }
  });
}

for (const days of [[], [1], [1, 1, 1], [1, 200], [1, 1000]]) {
  test(`play, complete, replay and replace: days ${JSON.stringify(days)}`, () => {
    const f = fixture(), scene = f.scene;
    const graph = { notes: days.map((day, i) => ({ day, path: `Synthetic/${i}.md`, name: `${i}`, group: 0, degree: 0 })),
      links: [], groups: days.length ? ["Synthetic"] : [], start: new Date(2026, 0, 1).getTime(), days: days.at(-1) ?? 1 };
    try {
      clocked(setTime => {
        scene.play(graph);
        const duration = Math.min(40000, Math.max(8000, graph.days * 60));
        assert.equal(scene.runMs, duration);
        assert.equal(scene.alive, days.filter(day => day <= 1).length);
        const first = [...scene.bornAt];
        setTime(1000 + duration); f.frame(); f.frame();
        assert.equal(scene.alive, days.length); assert.equal(scene.ended, 1);
        setTime(1000); scene.play(graph);
        assert.equal(scene.isRunning, true); assert.deepEqual(scene.bornAt, first);
        setTime(1000 + duration); f.frame(); assert.equal(scene.ended, 2);
        const replacement = builtGraph();
        scene.show(replacement); assert.equal(scene.alive, 6); assert.equal(scene.countThrough(3), 4);
        scene.play(replacement); assert.equal(scene.alive, 2); assert.equal(scene.countThrough(2), 2);
        assert.equal(scene.countThrough(10), 6); assert.equal(scene.countThrough(1), 2);
        assert.equal(scene.graph, replacement);
      });
    } finally { scene.destroy(); }
    assert.equal(f.frames.size, 0);
  });
}
