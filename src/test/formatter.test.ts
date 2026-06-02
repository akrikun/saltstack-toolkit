import { test } from "node:test";
import * as assert from "node:assert/strict";
import { normalizeJinjaExpressions, normalizeJinjaTags } from "../providers/formattingProvider";

// === enforceDash=true (default behavior) ===

test("formatter: opening tag gets dash when enforced", () => {
	assert.equal(normalizeJinjaExpressions("{% if x %}", true), "{%- if x %}");
	assert.equal(normalizeJinjaExpressions("{%if x%}", true), "{%- if x %}");
});

test("formatter: closing -%} is preserved (whitespace semantics)", () => {
	// CRITICAL: -%} controls runtime whitespace stripping. Must never be removed.
	assert.equal(normalizeJinjaExpressions("{%- if x -%}", true), "{%- if x -%}");
	assert.equal(normalizeJinjaExpressions("{% if x -%}", true), "{%- if x -%}");
	assert.equal(normalizeJinjaExpressions("{{- foo -}}", true), "{{- foo -}}");
});

test("formatter: opening dash on {{ }} preserved as-is", () => {
	assert.equal(normalizeJinjaExpressions("{{- foo }}", true), "{{- foo }}");
	assert.equal(normalizeJinjaExpressions("{{ foo }}", true), "{{ foo }}");
});

test("formatter: malformed/spaced tags get cleaned up", () => {
	assert.equal(normalizeJinjaExpressions("{{   foo   }}", true), "{{ foo }}");
	assert.equal(normalizeJinjaExpressions("{%-   if x   %}", true), "{%- if x %}");
});

// === Content-injecting tags (`include`) must never carry a dash ===
// Regression DO-52194: `{%- include "foo.sls" %}` strips the preceding newline
// and fuses the injected top-level YAML key onto the previous line, breaking the
// rendered pillar. The formatter must keep these tags dashless.

test("formatter: include never gets a dash when enforced", () => {
	assert.equal(
		normalizeJinjaExpressions('{% include "skkl-vmcluster/alertmanager.sls" with context %}', true),
		'{% include "skkl-vmcluster/alertmanager.sls" with context %}',
	);
});

test("formatter: existing leading dash on include is stripped", () => {
	assert.equal(
		normalizeJinjaExpressions('{%- include "foo.sls" %}', true),
		'{% include "foo.sls" %}',
	);
	assert.equal(
		normalizeJinjaExpressions('{%-include "foo.sls"%}', true),
		'{% include "foo.sls" %}',
	);
});

test("formatter: trailing -%} on include is stripped (fuses the next line)", () => {
	assert.equal(
		normalizeJinjaExpressions('{%- include "foo.sls" -%}', true),
		'{% include "foo.sls" %}',
	);
});

test("formatter: include stays dashless with enforceDash=false too", () => {
	assert.equal(
		normalizeJinjaExpressions('{%- include "foo.sls" %}', false),
		'{% include "foo.sls" %}',
	);
});

test("formatter: include normalization is idempotent", () => {
	const once = normalizeJinjaExpressions('{%- include "foo.sls" -%}', true);
	const twice = normalizeJinjaExpressions(once, true);
	assert.equal(twice, once);
});

// === enforceDash=false ===

test("formatter: with enforceDash=false, {% stays without dash", () => {
	assert.equal(normalizeJinjaExpressions("{% if x %}", false), "{% if x %}");
	assert.equal(normalizeJinjaExpressions("{%- if x %}", false), "{%- if x %}");
});

// === Comments are preserved verbatim ===

test("formatter: {# ... #} content is not touched", () => {
	const before = "{# preserve  this   spacing #}";
	assert.equal(normalizeJinjaTags(before, true), before);
});

test("formatter: code outside comments is normalized; comment block intact", () => {
	const input = "{%if x%} {# do not touch  this  #} {{var}}";
	const output = normalizeJinjaTags(input, true);
	assert.ok(output.includes("{# do not touch  this  #}"), "comment must be preserved");
	assert.ok(output.includes("{%- if x %}"), "code outside comment must be normalized");
	assert.ok(output.includes("{{ var }}"), "code outside comment must be normalized");
});

// === Idempotency: running formatter twice should be a no-op ===

test("formatter: idempotent on already-formatted input", () => {
	const cases = [
		"{%- if x %}",
		"{%- for item in items -%}",
		"{{ var }}",
		"{{- var -}}",
		"{# comment #}",
	];
	for (const input of cases) {
		const once = normalizeJinjaExpressions(input, true);
		const twice = normalizeJinjaExpressions(once, true);
		assert.equal(twice, once, `not idempotent: ${input} → ${once} → ${twice}`);
	}
});

// === Standalone closing tag on its own line (multi-line tag continuation) ===

test("formatter: standalone %} on a line is not touched", () => {
	// Was a real bug previously: the regex inserted a leading space.
	assert.equal(normalizeJinjaExpressions("%}", true), "%}");
	assert.equal(normalizeJinjaExpressions("}}", true), "}}");
});

test("formatter: trailing-only `set X = {` continuation works", () => {
	assert.equal(normalizeJinjaExpressions("{%- set nginx = {", true), "{%- set nginx = {");
});
