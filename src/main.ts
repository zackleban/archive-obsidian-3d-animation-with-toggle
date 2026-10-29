import { debounce, Notice, Plugin, setIcon, setTooltip, View } from "obsidian";
import { GraphScene } from "./scene";
import { buildGraph, findSubvaults, VaultGraph } from "./vault-graph";

type Mode = "2d" | "3d";
interface Settings { mode: Mode; }
interface Attached {
	wand: HTMLElement;
	button: HTMLElement;
	toggle: HTMLElement;
	options: HTMLElement[];
	cleanups: (() => void)[];
	scene: GraphScene | null;
	shape: string;
	request: number;
	alive: boolean;
	loadingAnimation: boolean;
}

export default class ThreeDAnimationPlugin extends Plugin {
	private prefs: Settings = { mode: "2d" };
	private attached = new Map<View, Attached>();
	private unloaded = false;

	async onload() {
		const saved = await this.loadData() as Partial<Settings> | null;
		this.prefs.mode = saved?.mode === "3d" ? "3d" : "2d";
		const attach = () => this.attachAll();
		this.app.workspace.onLayoutReady(attach);
		this.registerEvent(this.app.workspace.on("layout-change", attach));
		this.registerEvent(this.app.workspace.on("active-leaf-change", attach));
		this.registerEvent(this.app.workspace.on("css-change", () => this.attached.forEach((a) => a.scene?.recolor())));
		const refresh = debounce(() => this.refreshAll(), 1000, true);
		this.register(() => refresh.cancel());
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
	}

	onunload() {
		this.unloaded = true;
		this.attached.forEach((a) => this.detach(a));
		this.attached.clear();
	}

	private attachAll() {
		if (this.unloaded) return;
		const live = new Set<View>();
		for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
			if (leaf.isDeferred || !leaf.view.containerEl.isConnected) continue;
			const view = leaf.view;
			live.add(view);
			const wand = view.containerEl.querySelector<HTMLElement>(".graph-controls .graph-controls-button.mod-animate");
			const known = this.attached.get(view);
			if (known && this.ownsControls(view, known, wand)) continue;
			if (known) { this.detach(known); this.attached.delete(view); }
			if (wand) this.attached.set(view, this.attach(view, wand));
		}
		for (const [view, a] of this.attached) {
			if (live.has(view)) continue;
			this.detach(a);
			this.attached.delete(view);
		}
	}

	private attach(view: View, wand: HTMLElement): Attached {
		const button = view.containerEl.createEl("button", { cls: "clickable-icon graph-controls-button mod-animate-3d", attr: { type: "button", "aria-label": "Start 3D animation" } });
		setIcon(button, "box");
		setTooltip(button, "Start 3D animation");
		wand.insertAdjacentElement("afterend", button);
		const toggle = view.containerEl.createDiv({ cls: "three-d-toggle", attr: { role: "group", "aria-label": "Graph dimensions" } });
		button.insertAdjacentElement("afterend", toggle);
		const a: Attached = { wand, button, toggle, options: [], cleanups: [], scene: null, shape: "", request: 0, alive: true, loadingAnimation: false };
		const onClick = (el: HTMLElement, action: () => void) => {
			const handler = () => { if (this.isCurrent(view, a)) action(); };
			el.addEventListener("click", handler);
			a.cleanups.push(() => el.removeEventListener("click", handler));
		};
		for (const mode of ["2d", "3d"] as Mode[]) {
			const option = toggle.createEl("button", { cls: "three-d-toggle-option", text: mode.toUpperCase(), attr: { type: "button", "aria-label": `Show ${mode.toUpperCase()} graph` } });
			option.dataset.mode = mode;
			a.options.push(option);
			onClick(option, () => this.setMode(mode));
		}
		onClick(button, () => {
			this.setMode("3d");
			void this.render(view, a, true);
		});
		this.paintToggle(a);
		if (this.prefs.mode === "3d") void this.render(view, a);
		return a;
	}

	private ownsControls(view: View, a: Attached, wand: HTMLElement | null) {
		return a.alive && view.containerEl.isConnected && wand === a.wand && !!wand?.isConnected
			&& a.button.parentElement === wand.parentElement && a.toggle.parentElement === wand.parentElement
			&& a.options.length === 2 && a.options.every((option) => option.parentElement === a.toggle);
	}

	private isCurrent(view: View, a: Attached) {
		return !this.unloaded && this.attached.get(view) === a
			&& this.app.workspace.getLeavesOfType("graph").some((leaf) => leaf.view === view && !leaf.isDeferred)
			&& this.ownsControls(view, a, view.containerEl.querySelector<HTMLElement>(".graph-controls .graph-controls-button.mod-animate"));
	}

	private stop(a: Attached) {
		a.request++;
		a.loadingAnimation = false;
		const scene = a.scene;
		a.scene = null;
		scene?.destroy();
		a.button.removeClass("is-running");
	}

	private detach(a: Attached) {
		a.alive = false;
		for (const cleanup of a.cleanups.splice(0)) cleanup();
		this.stop(a);
		a.button.remove();
		for (const option of a.options) option.remove();
		a.toggle.remove();
	}

	private setMode(mode: Mode) {
		if (this.prefs.mode === mode) return;
		this.prefs.mode = mode;
		void this.saveData(this.prefs).catch((error: unknown) => this.report(error));
		for (const [view, a] of this.attached) {
			this.paintToggle(a);
			if (mode === "2d") this.stop(a);
			else void this.render(view, a);
		}
	}

	private paintToggle(a: Attached) {
		a.toggle.querySelectorAll<HTMLElement>(".three-d-toggle-option").forEach((el) => {
			const selected = el.dataset.mode === this.prefs.mode;
			el.toggleClass("is-active", selected);
			el.setAttribute("aria-pressed", String(selected));
		});
	}

	private sceneFor(view: View, a: Attached) {
		if (!a.scene) {
			const content = view.containerEl.querySelector<HTMLElement>(".view-content") ?? view.containerEl;
			a.scene = new GraphScene(content, {
				open: (path) => { void this.app.workspace.openLinkText(path, "", false).catch((error: unknown) => this.report(error)); },
				ended: () => { a.button.removeClass("is-running"); this.refreshAll(); },
				failed: (scene, error) => {
					if (this.unloaded || !a.alive || a.scene !== scene) return;
					this.setMode("2d");
					this.report(error);
				},
			});
		}
		return a.scene;
	}

	// Validate ownership at completion: attach() starts scans before map insertion,
	// and pane/control ownership can change before layout reconciliation arrives.
	private async render(view: View, a: Attached, animate = false, onlyChanged = false) {
		if (onlyChanged && a.loadingAnimation) return;
		const request = ++a.request;
		a.loadingAnimation = animate;
		try {
			const roots = await findSubvaults(this.app);
			if (this.unloaded || !a.alive || this.prefs.mode !== "3d" || request !== a.request || !this.isCurrent(view, a)) return;
			const graph = buildGraph(this.app, roots);
			const shape = shapeOf(graph);
			if (onlyChanged && shape === a.shape) return;
			const scene = this.sceneFor(view, a);
			a.shape = shape;
			a.button.toggleClass("is-running", animate);
			if (animate) scene.play(graph);
			else scene.show(graph);
		} catch (error) {
			if (!this.unloaded && a.alive && request === a.request && this.isCurrent(view, a)) {
				this.setMode("2d");
				this.report(error);
			}
		} finally {
			if (request === a.request) a.loadingAnimation = false;
		}
	}

	private refreshAll() {
		if (this.unloaded || this.prefs.mode !== "3d") return;
		for (const [view, a] of this.attached) {
			if (a.scene && !a.scene.isRunning) void this.render(view, a, false, true);
		}
	}

	private report(error: unknown) {
		// Either diagnostic channel may fail independently; neither may break recovery.
		try { console.error("3D Animation with Toggle:", error); } catch { /* Best-effort logging. */ }
		try {
			new Notice("Could not update the 3D graph. Check WebGL support and vault access; the 2D graph remains available.");
		} catch { /* Best-effort notice. */ }
	}
}

function shapeOf(graph: VaultGraph) {
	return JSON.stringify([graph.groups, graph.notes, graph.links, graph.start, graph.days]);
}
