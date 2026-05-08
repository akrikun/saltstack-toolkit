import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isAssignmentSet } from "../providers/diagnosticsProvider";

// `isAssignmentSet(text, tagStart)` returns true when the `set` tag at `tagStart`
// is an assignment form (no endset needed) and false when it's a block form.

test("set: assignment form (= present) → assignment", () => {
	assert.equal(isAssignmentSet("{% set x = 5 %}", 0), true);
	assert.equal(isAssignmentSet("{%- set x = 5 -%}", 0), true);
	assert.equal(isAssignmentSet("{% set x = pillar.foo | default({}) %}", 0), true);
});

test("set: block form (no =) → not assignment, needs endset", () => {
	assert.equal(isAssignmentSet("{% set greeting %}", 0), false);
	assert.equal(isAssignmentSet("{%- set greeting -%}", 0), false);
});

test("set: multi-line assignment opens dict — still assignment", () => {
	// Was previously a bug: `{%- set nginx = {` was incorrectly treated as a
	// block-set because the regex didn't recognize the `=`.
	assert.equal(isAssignmentSet("{%- set nginx = {", 0), true);
});

test("set: equals inside string in block form → still block", () => {
	// `{% set x %}value with = sign{% endset %}` — the `=` is in CONTENT, not in
	// the set tag itself. Our heuristic only looks before `%}`.
	assert.equal(isAssignmentSet("{% set x %}", 0), false);
});

test("set: tag at non-zero offset", () => {
	const text = "  {% set x = 5 %}";
	assert.equal(isAssignmentSet(text, 2), true);
});

test("set: multi-assignment (x, y = 1, 2)", () => {
	// Multi-assignment is uncommon but should be detected as assignment.
	// Note: Jinja itself uses `{% set x = 1, 2 %}` for tuple assignment.
	assert.equal(isAssignmentSet("{% set x = 1, 2 %}", 0), true);
});

test("set: block-set with filter that contains '=' is NOT assignment", () => {
	// Was a false-positive: filter `upper(first=true)` contained `=` so the
	// whole tag was misclassified as assignment, missing endset went unreported.
	assert.equal(isAssignmentSet("{% set greeting | upper(first=true) %}", 0), false);
});

test("set: block-set with multiple piped filters with kwargs", () => {
	assert.equal(isAssignmentSet("{%- set body | trim | replace(old='a', new='b') -%}", 0), false);
});

test("set: dotted target (ns.foo = ...) is assignment", () => {
	assert.equal(isAssignmentSet("{% set ns.foo = 1 %}", 0), true);
});

test("set: tuple assignment (a, b = 1, 2)", () => {
	assert.equal(isAssignmentSet("{% set a, b = 1, 2 %}", 0), true);
});

test("set: malformed `{% set %}` (no name) → block (will fail elsewhere)", () => {
	assert.equal(isAssignmentSet("{% set %}", 0), false);
});
