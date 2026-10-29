// The subset of d3-force-3d's public API used by this plugin.
declare module "d3-force-3d" {
	export interface SimulationNode {
		index?: number;
		x?: number;
		y?: number;
		z?: number;
		group: number;
	}
	export interface Force { strength(value: number): this; }
	export interface LinkForce extends Force {
		links(value: { source: number; target: number }[]): this;
		distance(value: number): this;
	}
	export interface ManyBodyForce extends Force { distanceMax(value: number): this; }
	export interface Simulation {
		stop(): this;
		nodes(value: SimulationNode[]): this;
		force(name: string): Force | undefined;
		force(name: string, force: Force): this;
		alpha(): number;
		alpha(value: number): this;
		alphaMin(): number;
		tick(): this;
	}
	export function forceSimulation(nodes?: SimulationNode[], dimensions?: number): Simulation;
	export function forceLink(links?: { source: number; target: number }[]): LinkForce;
	export function forceManyBody(): ManyBodyForce;
	export function forceX(x?: (node: SimulationNode) => number): Force;
	export function forceY(y?: (node: SimulationNode) => number): Force;
	export function forceZ(z?: (node: SimulationNode) => number): Force;
}
