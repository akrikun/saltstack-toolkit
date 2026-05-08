import { test } from "node:test";
import * as assert from "node:assert/strict";
import { extractStateIds } from "../workspaceIndex";

// Use a stub URI since we only care about per-line extraction here.
const stubUri = { fsPath: "/tmp/test.sls" } as any;

test("index: extracts simple state IDs at indent 0", () => {
	const text = [
		"foo:",
		"  cmd.run:",
		"    - name: echo hi",
		"",
		"bar:",
		"  test.nop",
	].join("\n");
	const entries = extractStateIds(text, stubUri);
	assert.deepEqual(entries.map((e) => e.stateId), ["foo", "bar"]);
});

test("index: state IDs with inline values are extracted", () => {
	const text = [
		"key: $host",
		"another:",
		"  test.nop",
	].join("\n");
	const entries = extractStateIds(text, stubUri);
	assert.deepEqual(entries.map((e) => e.stateId), ["key", "another"]);
});

test("index: skips include/extend/exclude structural keys", () => {
	const text = [
		"include:",
		"  - foo",
		"  - bar",
		"",
		"extend:",
		"  some_id:",
		"    test.nop",
		"",
		"real_state:",
		"  test.nop",
	].join("\n");
	const entries = extractStateIds(text, stubUri);
	// Note: include/extend lines themselves are skipped; the `some_id` entry
	// inside the extend block is indented and so isn't a top-level state ID.
	assert.deepEqual(entries.map((e) => e.stateId), ["real_state"]);
});

test("index: items inside an `include:` block are not state IDs", () => {
	const text = [
		"include:",
		"  - foo.bar",
		"  - baz",
		"",
		"my_state:",
		"  test.nop",
	].join("\n");
	const entries = extractStateIds(text, stubUri);
	assert.deepEqual(entries.map((e) => e.stateId), ["my_state"]);
});

test("index: comments and Jinja are skipped", () => {
	const text = [
		"# top comment",
		"{% set x = 1 %}",
		"my_state:",
		"  test.nop",
	].join("\n");
	const entries = extractStateIds(text, stubUri);
	assert.deepEqual(entries.map((e) => e.stateId), ["my_state"]);
});

test("index: line numbers are reported correctly (0-based)", () => {
	const text = [
		"# header",
		"",
		"first:",
		"  test.nop",
		"",
		"second:",
		"  test.nop",
	].join("\n");
	const entries = extractStateIds(text, stubUri);
	assert.equal(entries[0].line, 2);
	assert.equal(entries[1].line, 5);
});
