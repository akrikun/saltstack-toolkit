// Build test files for `node --test`. Stubs the `vscode` module since tests
// only exercise pure logic functions; any import of `vscode` resolves to {}.
import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const testDir = "src/test";
const testFiles = readdirSync(testDir)
	.filter((f) => f.endsWith(".test.ts"))
	.map((f) => join(testDir, f));

const stubVscode = {
	name: "stub-vscode",
	setup(build) {
		build.onResolve({ filter: /^vscode$/ }, (args) => ({
			path: args.path, namespace: "vscode-stub",
		}));
		build.onLoad({ filter: /.*/, namespace: "vscode-stub" }, () => ({
			contents: "module.exports = {};",
			loader: "js",
		}));
	},
};

await esbuild.build({
	entryPoints: testFiles,
	bundle: true,
	outdir: "out/test",
	format: "cjs",
	platform: "node",
	target: "node18",
	sourcemap: true,
	plugins: [stubVscode],
});

console.log(`Built ${testFiles.length} test bundles.`);
