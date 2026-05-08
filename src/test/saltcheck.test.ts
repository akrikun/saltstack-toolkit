import { test } from "node:test";
import * as assert from "node:assert/strict";
import { findSaltcheckIssues } from "../providers/diagnosticsProvider";

function lines(s: string): string[] {
	return s.replace(/^\n/, "").split("\n");
}

test("saltcheck: block with assertion → no issue", () => {
	const src = lines(`
test_ping:
  module_and_run: test.ping
  assertion: assertEqual
  expected-return: True
`);
	assert.equal(findSaltcheckIssues(src).length, 0);
});

test("saltcheck: block without assertion → flagged", () => {
	const src = lines(`
test_running:
  module_and_run: service.status
  expected-return: True
`);
	const issues = findSaltcheckIssues(src);
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /test_running/);
	assert.match(issues[0].message, /assertion/);
});

test("saltcheck: multiple blocks, only flag the bad ones", () => {
	const src = lines(`
good_test:
  module_and_run: test.ping
  assertion: assertTrue

bad_test:
  module_and_run: foo.bar
  expected-return: 1

another_good:
  module_and_run: x.y
  assertion: assertNotEmpty
`);
	const issues = findSaltcheckIssues(src);
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /bad_test/);
});

test("saltcheck: comments and Jinja are ignored", () => {
	const src = lines(`
# comment about the test
{% set x = 5 %}
test_ok:
  module_and_run: x.y
  assertion: assertEqual
  expected-return: 5
`);
	assert.equal(findSaltcheckIssues(src).length, 0);
});
