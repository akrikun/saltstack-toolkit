import * as vscode from "vscode";
import * as path from "path";
import { isPillarFile, resolvePillarPath, getPillarKeyPath } from "../pillarContext";
import { PillarUsageCache } from "../pillarUsageCache";
import { WorkspaceStateIndex } from "../workspaceIndex";

/**
 * Go-to-definition for:
 *  - Jinja imports: {% from "formula/map.jinja" import ... %}
 *  - Jinja includes: {% include "template.jinja" %} (both state and pillar)
 *  - Jinja extends: {% extends "base.jinja" %}
 *  - salt:// source references: source: salt://formula/files/template.jinja
 *  - SLS includes: - .substate  or  - formula.substate
 *  - Requisite references: - state_id_name
 *  - Pillar includes: {% include "defaults/platform.sls" %}
 */
export class SaltDefinitionProvider implements vscode.DefinitionProvider {

	constructor(
		private pillarUsageCache: PillarUsageCache,
		private workspaceIndex: WorkspaceStateIndex,
	) {}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Definition | null> {
		const line = document.lineAt(position).text;
		const inPillar = isPillarFile(document);

		// Jinja from/import/include/extends, plus Salt-specific
		// import_yaml / import_json / import_text.
		const jinjaPathMatch = line.match(
			/\{%[-\s]*(?:from|import|include|extends|import_yaml|import_json|import_text)\s+["']([^"']+)["']/,
		);
		if (jinjaPathMatch) {
			const target = jinjaPathMatch[1];
			// In pillar files, resolve against pillar roots first
			if (inPillar) {
				const pillarLocations = await this.resolvePillarInclude(document, target);
				if (pillarLocations && pillarLocations.length > 0) return pillarLocations;
			}
			return this.resolveSlsPath(document, target);
		}

		// salt:// source reference (anywhere on the line; cursor must be on it)
		const saltTarget = extractSaltUri(line, position.character);
		if (saltTarget) {
			return this.resolveSlsPath(document, saltTarget);
		}

		// salt.fast_yaml.hosts("common_meta") — custom module loads a YAML file
		// by basename. Resolve cursor-on-string-arg to <name>.{yaml,yml,sls}
		// anywhere under stateRoots / pillarRoots.
		const fastYamlTarget = extractFastYamlArg(line, position.character);
		if (fastYamlTarget) {
			const locs = await this.resolveByBasename(fastYamlTarget);
			if (locs && locs.length > 0) return locs;
		}

		// SLS include entry: "  - .substate" or "  - formula.substate"
		const includeMatch = line.match(/^\s+-\s+(\.[\w./\-]+|[\w][\w./\-]*)$/);
		if (includeMatch) {
			const ref = includeMatch[1].trim();
			return this.resolveSlsInclude(document, ref);
		}

		// Requisite reference (untyped): "      - state_id_name"
		// or typed: "      - file: state_id_name"
		// Use any indent ≥ 4 (relative position is checked semantically by
		// looking for state ID, not by hardcoded 6 spaces).
		if (!inPillar) {
			const requisiteRefMatch = line.match(/^\s+-\s+(?:(\w+):\s+)?([\w][\w.\-/() ]*)\s*$/);
			if (requisiteRefMatch) {
				const stateId = requisiteRefMatch[2].trim();
				// First try local file
				const local = this.findStateIdInDocument(document, stateId);
				if (local) return local;
				// Fall back to workspace index for cross-file refs
				const cross = await this.workspaceIndex.findStateIdDeclarations(stateId);
				if (cross.length > 0) return cross;
			}
		}

		// In pillar files: clicking on a key (top-level or nested) — find usages in state files
		if (inPillar) {
			const keyPath = getPillarKeyPath(document, position);
			if (keyPath && keyPath.length > 0) {
				const locations = await this.pillarUsageCache.findUsages(keyPath);
				return locations.length > 0 ? locations : null;
			}
		}

		return null;
	}

	private async resolvePillarInclude(
		document: vscode.TextDocument,
		targetPath: string,
	): Promise<vscode.Location[] | null> {
		// Try resolving from pillarRoots
		const uris = await resolvePillarPath(targetPath);
		if (uris.length > 0) {
			return uris.map((uri) => new vscode.Location(uri, new vscode.Position(0, 0)));
		}

		// Try relative to current file directory
		const currentDir = path.dirname(document.uri.fsPath);
		const relativeUri = vscode.Uri.file(path.join(currentDir, targetPath));
		if (await this.fileExists(relativeUri)) {
			return [new vscode.Location(relativeUri, new vscode.Position(0, 0))];
		}

		return null;
	}

	private async resolveSlsPath(
		document: vscode.TextDocument,
		targetPath: string,
	): Promise<vscode.Location[] | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return null;

		const locations: vscode.Location[] = [];
		const config = vscode.workspace.getConfiguration("saltstack");

		for (const folder of workspaceFolders) {
			// Try direct path relative to workspace root
			const directUri = vscode.Uri.joinPath(folder.uri, targetPath);
			if (await this.fileExists(directUri)) {
				locations.push(new vscode.Location(directUri, new vscode.Position(0, 0)));
			}

			// Try configured state roots
			const stateRoots = config.get<string[]>("stateRoots", ["salt", "srv/salt"]);
			for (const root of stateRoots) {
				const uri = path.isAbsolute(root)
					? vscode.Uri.file(path.join(root, targetPath))
					: vscode.Uri.joinPath(folder.uri, root, targetPath);
				if (await this.fileExists(uri)) {
					locations.push(new vscode.Location(uri, new vscode.Position(0, 0)));
				}
			}

			// Try configured pillar roots
			const pillarRoots = config.get<string[]>("pillarRoots", ["pillar", "srv/pillar"]);
			for (const root of pillarRoots) {
				const uri = path.isAbsolute(root)
					? vscode.Uri.file(path.join(root, targetPath))
					: vscode.Uri.joinPath(folder.uri, root, targetPath);
				if (await this.fileExists(uri)) {
					locations.push(new vscode.Location(uri, new vscode.Position(0, 0)));
				}
			}
		}

		// Try relative to current file directory
		const currentDir = path.dirname(document.uri.fsPath);
		const relativeUri = vscode.Uri.file(path.join(currentDir, targetPath));
		if (await this.fileExists(relativeUri)) {
			locations.push(new vscode.Location(relativeUri, new vscode.Position(0, 0)));
		}

		return locations.length > 0 ? locations : null;
	}

	private async resolveSlsInclude(
		document: vscode.TextDocument,
		ref: string,
	): Promise<vscode.Location[] | null> {
		// ".substate" is relative to current formula directory
		if (ref.startsWith(".")) {
			const currentDir = path.dirname(document.uri.fsPath);
			const relative = ref.substring(1).replace(/\./g, "/");

			// Try init.sls first, then direct .sls
			const candidates = [
				path.join(currentDir, relative + ".sls"),
				path.join(currentDir, relative, "init.sls"),
			];

			for (const candidate of candidates) {
				const uri = vscode.Uri.file(candidate);
				if (await this.fileExists(uri)) {
					return [new vscode.Location(uri, new vscode.Position(0, 0))];
				}
			}
		} else {
			// Absolute reference: "formula.substate" -> "formula/substate.sls"
			const slsPath = ref.replace(/\./g, "/");
			return this.resolveSlsPath(document, slsPath + ".sls")
				|| this.resolveSlsPath(document, slsPath + "/init.sls");
		}

		return null;
	}

	private findStateIdInDocument(
		document: vscode.TextDocument,
		stateId: string,
	): vscode.Location | null {
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			if (line.text.match(new RegExp(`^${escapeRegex(stateId)}:\\s*$`))) {
				return new vscode.Location(document.uri, new vscode.Position(i, 0));
			}
		}
		return null;
	}

	private async fileExists(uri: vscode.Uri): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Find every file whose basename (without extension) is `name` and whose
	 * extension is one of `.yaml`/`.yml`/`.sls`/`.json`, anywhere under
	 * the configured stateRoots and pillarRoots. Used for resolving Salt
	 * custom modules that load files by name (e.g. `fast_yaml.hosts`).
	 */
	private async resolveByBasename(name: string): Promise<vscode.Location[] | null> {
		const config = vscode.workspace.getConfiguration("saltstack");
		const stateRoots = config.get<string[]>("stateRoots", ["salt", "srv/salt"]);
		const pillarRoots = config.get<string[]>("pillarRoots", ["pillar", "srv/pillar"]);
		const wsFolders = vscode.workspace.workspaceFolders ?? [];

		const bases: string[] = [];
		for (const root of [...stateRoots, ...pillarRoots]) {
			if (path.isAbsolute(root)) bases.push(root);
			else for (const folder of wsFolders) bases.push(path.join(folder.uri.fsPath, root));
		}

		const locations: vscode.Location[] = [];
		const seen = new Set<string>();
		for (const base of bases) {
			const pattern = new vscode.RelativePattern(base, `**/${name}.{yaml,yml,sls,json}`);
			const found = await vscode.workspace.findFiles(pattern);
			for (const uri of found) {
				if (seen.has(uri.fsPath)) continue;
				seen.add(uri.fsPath);
				locations.push(new vscode.Location(uri, new vscode.Position(0, 0)));
			}
		}
		return locations.length > 0 ? locations : null;
	}
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the first quoted argument of `salt.fast_yaml.hosts(...)` or
 * `salt['fast_yaml.hosts'](...)`, if the cursor sits inside it.
 *
 *   salt.fast_yaml.hosts("common_meta")           → "common_meta"
 *   salt.fast_yaml.hosts('common_meta', ...)      → "common_meta"
 *   salt['fast_yaml.hosts']("common_meta")        → "common_meta"
 *
 * Exported for testing.
 */
export function extractFastYamlArg(line: string, cursorChar: number): string | null {
	const re = /(?:salt\.fast_yaml\.hosts|salt\[['"]fast_yaml\.hosts['"]\])\s*\(\s*['"]([^'"]+)['"]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		// Cursor must fall within the captured arg span.
		const argStart = line.indexOf(m[1], m.index);
		const argEnd = argStart + m[1].length;
		if (cursorChar >= argStart && cursorChar <= argEnd) return m[1];
	}
	return null;
}

/**
 * Extract the `salt://...` path from a line, if the cursor falls inside it.
 * Handles quoted and unquoted forms; strips trailing query (?), hash (#) and comments.
 *
 *   source: salt://foo/bar.conf            → "foo/bar.conf"
 *   source: 'salt://foo/bar.conf'          → "foo/bar.conf"
 *   - "salt://foo/bar.conf?env=base"       → "foo/bar.conf"
 *   - salt://foo/bar.conf  # comment       → "foo/bar.conf"
 *
 * Exported for testing.
 */
export function extractSaltUri(line: string, cursorChar: number): string | null {
	// Match includes ?query and #fragment so the cursor-in-token check works
	// even when the user clicks inside the query/hash; we strip those after.
	const re = /salt:\/\/([^\s'"]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		const start = m.index;
		const end = start + m[0].length; // exclusive
		if (cursorChar < start || cursorChar >= end) continue;
		return m[1].split(/[?#]/, 1)[0];
	}
	return null;
}
