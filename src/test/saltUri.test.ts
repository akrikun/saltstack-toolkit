import { test } from "node:test";
import * as assert from "node:assert/strict";
import { extractSaltUri, extractFastYamlArg } from "../providers/definitionProvider";

// `extractSaltUri(line, cursorChar)` finds the `salt://...` reference under
// the cursor and returns the bare path (no scheme, query, hash, or quotes).

test("salt-uri: bare unquoted form", () => {
	const line = "    - source: salt://nginx/files/nginx.conf";
	// Cursor anywhere on `salt://nginx/files/nginx.conf`
	assert.equal(extractSaltUri(line, 25), "nginx/files/nginx.conf");
});

test("salt-uri: single-quoted form", () => {
	const line = "    - source: 'salt://nginx/files/nginx.conf'";
	assert.equal(extractSaltUri(line, 25), "nginx/files/nginx.conf");
});

test("salt-uri: double-quoted form", () => {
	const line = `    - source: "salt://nginx/files/nginx.conf"`;
	assert.equal(extractSaltUri(line, 25), "nginx/files/nginx.conf");
});

test("salt-uri: trailing comment is stripped", () => {
	const line = "    - source: salt://nginx/foo.conf  # main config";
	assert.equal(extractSaltUri(line, 30), "nginx/foo.conf");
});

test("salt-uri: query string is stripped", () => {
	const line = "    - source: salt://nginx/foo.conf?env=base";
	assert.equal(extractSaltUri(line, 30), "nginx/foo.conf");
});

test("salt-uri: hash fragment is stripped", () => {
	const line = "    - source: salt://nginx/foo.conf#section";
	assert.equal(extractSaltUri(line, 30), "nginx/foo.conf");
});

test("salt-uri: cursor outside the salt:// → null", () => {
	const line = "    - source: salt://nginx/foo.conf  # comment text here";
	// Cursor on the comment text — far from salt://
	assert.equal(extractSaltUri(line, 50), null);
});

test("salt-uri: list-form `- salt://...`", () => {
	const line = "      - salt://nginx/foo.conf";
	assert.equal(extractSaltUri(line, 15), "nginx/foo.conf");
});

test("salt-uri: returns null when no salt:// on line", () => {
	assert.equal(extractSaltUri("    - source: /etc/nginx.conf", 10), null);
});

test("salt-uri: cursor on ?query is still inside the URI token", () => {
	// `salt://foo.conf?env=base` — cursor on "env" should still resolve.
	const line = "    - source: salt://foo.conf?env=base";
	const cursorOnQuery = line.indexOf("env");
	assert.equal(extractSaltUri(line, cursorOnQuery), "foo.conf");
});

test("salt-uri: cursor on #hash is still inside the URI token", () => {
	const line = "    - source: salt://foo.conf#section";
	const cursorOnHash = line.indexOf("section");
	assert.equal(extractSaltUri(line, cursorOnHash), "foo.conf");
});

test("salt-uri: cursor at end (exclusive) → null", () => {
	// Position right after the last char of the URI must NOT match.
	const line = "    - source: salt://foo";
	const justPastEnd = line.length;
	assert.equal(extractSaltUri(line, justPastEnd), null);
});

test("salt-uri: cursor at start (inclusive) → match", () => {
	const line = "    - source: salt://foo";
	const start = line.indexOf("salt://");
	assert.equal(extractSaltUri(line, start), "foo");
});

// === fast_yaml.hosts() arg extraction ===

test("fast_yaml: dot form, cursor on arg", () => {
	const line = `{%- set meta = salt.fast_yaml.hosts("common_meta") %}`;
	assert.equal(extractFastYamlArg(line, line.indexOf("common_meta")), "common_meta");
});

test("fast_yaml: bracket form", () => {
	const line = `{{ salt['fast_yaml.hosts']('common_meta') }}`;
	assert.equal(extractFastYamlArg(line, line.indexOf("common_meta")), "common_meta");
});

test("fast_yaml: extra args (kwargs)", () => {
	const line = `salt.fast_yaml.hosts("common_meta", attribute="ip")`;
	assert.equal(extractFastYamlArg(line, line.indexOf("common_meta")), "common_meta");
});

test("fast_yaml: cursor outside arg → null", () => {
	const line = `salt.fast_yaml.hosts("common_meta")`;
	// cursor on `salt`
	assert.equal(extractFastYamlArg(line, 1), null);
});

test("fast_yaml: not a fast_yaml call → null", () => {
	const line = `salt['pillar.get']('common_meta')`;
	assert.equal(extractFastYamlArg(line, line.indexOf("common_meta")), null);
});
