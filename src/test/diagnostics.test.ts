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
