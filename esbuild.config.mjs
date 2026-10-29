import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { builtinModules as builtins } from "node:module";

const production = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	banner: { js: "/*!\n" + readFileSync("THIRD_PARTY_NOTICES.md", "utf8").replace(/\*\//g, "* /") + "*/" },
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtins,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
