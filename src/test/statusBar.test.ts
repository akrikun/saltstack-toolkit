import { test } from "node:test";
import * as assert from "node:assert/strict";
import { matchRoot } from "../saltStatusBar";

test("statusBar: relative root resolved against workspace folder", () => {
	const result = matchRoot(
		"/work/proj/salt/nginx/init.sls",
		["salt", "pillar"],
		["/work/proj"],
	);
	assert.deepEqual(result, { root: "salt" });
});

test("statusBar: absolute root", () => {
	const result = matchRoot(
		"/abs/states/foo/init.sls",
		["/abs/states"],
		["/work/proj"],
	);
	assert.deepEqual(result, { root: "/abs/states" });
});

test("statusBar: file outside any root → null", () => {
	const result = matchRoot(
		"/tmp/foo.sls",
		["salt", "/abs/states"],
		["/work/proj"],
	);
	assert.equal(result, null);
});

test("statusBar: prefers first matching root", () => {
	const result = matchRoot(
		"/work/proj/salt/foo.sls",
		["salt", "srv/salt"],
		["/work/proj"],
	);
	assert.deepEqual(result, { root: "salt" });
});
