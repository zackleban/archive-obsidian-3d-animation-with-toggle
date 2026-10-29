import { build } from "esbuild";
import { createRequire, Module } from "node:module";
import { resolve } from "node:path";

export class TAbstractFile {
  constructor(path) { this.path = path; this.parent = null; }
  get name() { return this.path.split("/").at(-1); }
}
export class TFile extends TAbstractFile {
  get basename() { return this.name.replace(/\.[^.]+$/, ""); }
  get extension() { return this.name.split(".").at(-1); }
}
export class TFolder extends TAbstractFile {
  children = [];
  isRoot() { return this.path === "/"; }
}
export const notices = [];
export class Plugin {
  constructor(app) { this.app = app; this.saved = null; this.events = []; this.cleanups = []; }
  async loadData() { return this.saved; }
  async saveData(value) { this.saved = structuredClone(value); }
  registerEvent(event) { this.events.push(event); }
  register(fn) { this.cleanups.push(fn); }
  addSettingTab() {}
  addCommand() {}
  registerDomEvent() {}
}
export const obsidian = {
  Plugin, TAbstractFile, TFile, TFolder,
  App: class {}, View: class {}, Menu: class {}, MenuItem: class {},
  Modal: class {}, PluginSettingTab: class {}, Setting: class {},
  Notice: class { constructor(text) { notices.push(text); } },
  normalizePath: (path) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
  parseYaml: JSON.parse,
  debounce: (fn) => Object.assign(fn, { cancel() {} }),
  setIcon() {}, setTooltip() {},
};
export async function load(source, extra = {}, scene = undefined) {
  const result = await build({ entryPoints: [source], bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian", "__scene__"], plugins: scene ? [{ name: "scene-mock", setup(build) { build.onResolve({filter: /^\.\/scene$/}, () => ({path: "__scene__", external: true})); } }] : [] });
  const mod = new Module(resolve(source));
  const require = createRequire(import.meta.url);
  mod.require = (id) => id === "obsidian" ? {...obsidian, ...extra} : id === "__scene__" ? scene : require(id);
  mod._compile(result.outputFiles[0].text, resolve(source));
  return mod.exports;
}
