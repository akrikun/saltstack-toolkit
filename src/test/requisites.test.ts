import { test } from "node:test";
import * as assert from "node:assert/strict";
import { findUnknownRequisiteRefs } from "../providers/diagnosticsProvider";

function lines(s: string): string[] {
	return s.replace(/^\n/, "").split("\n");
}

test("requisites: 4-space indent (not just 6) — known ref OK", () => {
	const src = lines(`
local_state:
  cmd.run:
    - name: echo hi

second_state:
  cmd.run:
    - name: echo bye
    - require:
      - local_state
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0, `expected no issues, got: ${JSON.stringify(issues)}`);
});

test("requisites: unknown ref → flagged", () => {
	const src = lines(`
my_state:
  cmd.run:
    - name: echo hi
    - require:
      - missing_id
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /missing_id/);
});

test("requisites: typed `- file: state_id` (id known) → OK", () => {
	const src = lines(`
foo:
  file.managed:
    - name: /etc/foo

bar:
  service.running:
    - watch:
      - file: foo
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0);
});

test("requisites: typed `- file: /etc/path` (path target, not local id) → not flagged", () => {
	const src = lines(`
my_state:
  cmd.run:
    - name: do
    - require:
      - file: /etc/app.conf
      - pkg: nginx
`);
	const issues = findUnknownRequisiteRefs(src);
	// /etc/app.conf has /, so skipped. nginx is just an external state name (typed),
	// could legitimately be from another formula. We only flag untyped refs.
	const flagged = issues.filter((i) => /nginx/.test(i.message) || /\/etc\/app\.conf/.test(i.message));
	assert.equal(flagged.length, 0, `unexpected: ${JSON.stringify(flagged)}`);
});

test("requisites: relative include like `.foo` → not flagged", () => {
	const src = lines(`
my_state:
  cmd.run:
    - name: do
    - require:
      - .other_formula
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0);
});

test("requisites: Jinja-templated ref → not flagged", () => {
	const src = lines(`
my_state:
  cmd.run:
    - name: do
    - require:
      - {{ ref }}
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0);
});

test("requisites: typed ref to fully-qualified state (foo.bar) → not flagged", () => {
	const src = lines(`
my_state:
  cmd.run:
    - require:
      - file: nginx.config
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0);
});

test("requisites: 8-space indent (deeply nested) — works", () => {
	const src = lines(`
my_state:
        cmd.run:
                - name: do
                - require:
                        - other_id

other_id:
        test.nop
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0);
});

test("requisites: detects exit from requisite block when indent decreases", () => {
	const src = lines(`
my_state:
  cmd.run:
    - require:
      - foo
    - name: cmd_after_requisite

foo:
  test.nop
`);
	const issues = findUnknownRequisiteRefs(src);
	// `cmd_after_requisite` is a value, not a requisite ref. Should not be flagged.
	const flagged = issues.filter((i) => /cmd_after_requisite/.test(i.message));
	assert.equal(flagged.length, 0);
});

test("requisites: state IDs with inline values are still collected", () => {
	const src = lines(`
key_with_value: $host

other:
  cmd.run:
    - require:
      - key_with_value
`);
	const issues = findUnknownRequisiteRefs(src);
	assert.equal(issues.length, 0, `key_with_value should be detected as state ID`);
});
