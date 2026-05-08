import { test } from "node:test";
import * as assert from "node:assert/strict";
import { extractSaltUri } from "../providers/definitionProvider";

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
