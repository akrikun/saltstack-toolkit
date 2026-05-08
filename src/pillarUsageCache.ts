import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

/**
 * Cache for pillar key usages search.
 *
 * Two-level cache:
 *  - File list cache: list of state files, invalidated when files added/removed
 *  - File content cache: per-file text + mtime + analysis (aliases, dict maps, imports),
 *    invalidated when file modified
 *
 * Tracks indirect pillar references via:
 *  - Local Jinja aliases: `{% set foo = pillar.x %}` → `foo.y` references `pillar.x.y`
 *  - Imported dict vars: `{% from "X.jinja" import bar %}` where X.jinja has
 *    `{% set bar = { 'key': pillar.foo.key } %}` → `bar.key` references `pillar.foo.key`
 */
export class PillarUsageCache {
	private fileListCache: vscode.Uri[] | null = null;
	private fileContentCache = new Map<string, FileEntry>();
	private watchers: vscode.Disposable[] = [];

	constructor() {
		this.watchers.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("saltstack.stateRoots")) {
					this.invalidateFileList();
				}
			}),
		);

		const fsWatcher = vscode.workspace.createFileSystemWatcher("**/*.{sls,jinja,j2,jinja2}");
		fsWatcher.onDidChange((uri) => this.fileContentCache.delete(uri.fsPath));
		fsWatcher.onDidCreate(() => this.invalidateFileList());
		fsWatcher.onDidDelete((uri) => {
			this.fileContentCache.delete(uri.fsPath);
			this.invalidateFileList();
		});
		this.watchers.push(fsWatcher);

		this.watchers.push(
			vscode.workspace.onDidSaveTextDocument((doc) => {
				this.fileContentCache.delete(doc.uri.fsPath);
			}),
		);
	}

	dispose(): void {
		for (const w of this.watchers) w.dispose();
	}

	private invalidateFileList(): void {
		this.fileListCache = null;
	}

	private async getStateFiles(): Promise<vscode.Uri[]> {
		if (this.fileListCache) return this.fileListCache;
		const config = vscode.workspace.getConfiguration("saltstack");
		const stateRoots = config.get<string[]>("stateRoots", ["salt", "srv/salt"]);
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

		const bases: string[] = [];
		for (const root of stateRoots) {
			if (path.isAbsolute(root)) {
				bases.push(root);
			} else {
				for (const folder of workspaceFolders) {
					bases.push(path.join(folder.uri.fsPath, root));
				}
			}
		}

		const seen = new Set<string>();
		const files: vscode.Uri[] = [];
		for (const base of bases) {
			const pattern = new vscode.RelativePattern(base, "**/*.{sls,jinja,j2,jinja2}");
			const found = await vscode.workspace.findFiles(pattern);
			for (const uri of found) {
				if (!seen.has(uri.fsPath)) {
					seen.add(uri.fsPath);
					files.push(uri);
				}
			}
		}
		this.fileListCache = files;
		return files;
	}

	private async getEntry(uri: vscode.Uri): Promise<FileEntry | null> {
		try {
			const stat = await fs.stat(uri.fsPath);
			const cached = this.fileContentCache.get(uri.fsPath);
			if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
			const text = await fs.readFile(uri.fsPath, "utf8");
			const entry: FileEntry = {
				mtimeMs: stat.mtimeMs,
				text,
				...analyzeFile(text),
			};
			this.fileContentCache.set(uri.fsPath, entry);
			return entry;
		} catch {
			return null;
		}
	}

	async findUsages(searchPath: string[]): Promise<vscode.Location[]> {
		if (searchPath.length === 0) return [];
		const files = await this.getStateFiles();

		// Phase 1: load all entries (cached)
		const entries = new Map<string, FileEntry>();
		const stateRoots = getResolvedStateRoots();
		await Promise.all(files.map(async (uri) => {
			const entry = await this.getEntry(uri);
			if (entry) entries.set(uri.fsPath, entry);
		}));

		// Phase 2: search each file for matches
		const locations: vscode.Location[] = [];
		const directRe = buildPathRegex(searchPath);

		for (const uri of files) {
			const entry = entries.get(uri.fsPath);
			if (!entry) continue;
			const text = entry.text;

			// 1. Direct pillar.X.Y access
			collectMatches(text, directRe, uri, locations);

			// 2. Local aliases: set X = pillar.Y
			for (const [varName, aliasPath] of entry.aliases) {
				if (!isPrefix(aliasPath, searchPath)) continue;
				const remaining = searchPath.slice(aliasPath.length);
				if (remaining.length === 0) {
					const re = new RegExp(`\\b${escapeRegex(varName)}\\b`, "g");
					collectMatches(text, re, uri, locations);
				} else {
					const re = buildVarPathRegex(varName, remaining);
					collectMatches(text, re, uri, locations);
				}
			}

			// 3. Cross-file: from "X.jinja" import VAR — VAR may be a dict map
			for (const [importedVar, importPath] of entry.imports) {
				const sourceUri = resolveImport(importPath, stateRoots, files);
				if (!sourceUri) continue;
				const sourceEntry = entries.get(sourceUri.fsPath);
				if (!sourceEntry) continue;

				// Case A: imported var is a dict map
				const dictMap = sourceEntry.dictMaps.get(importedVar);
				if (dictMap) {
					for (const [key, keyPath] of dictMap) {
						if (!isPrefix(keyPath, searchPath)) continue;
						const remaining = searchPath.slice(keyPath.length);
						const baseRe = `\\b${escapeRegex(importedVar)}\\.${escapeRegex(key)}`;
						if (remaining.length === 0) {
							const re = new RegExp(`${baseRe}\\b`, "g");
							collectMatches(text, re, uri, locations);
						} else {
							const partGroup = remaining.map((p) => {
								const e = escapeRegex(p);
								return `(?:\\.${e}|\\[["']${e}["']\\])`;
							}).join("");
							const re = new RegExp(`${baseRe}${partGroup}`, "g");
							collectMatches(text, re, uri, locations);
						}
					}
				}

				// Case B: imported var is itself an alias to pillar.X
				const sourceAlias = sourceEntry.aliases.get(importedVar);
				if (sourceAlias && isPrefix(sourceAlias, searchPath)) {
					const remaining = searchPath.slice(sourceAlias.length);
					if (remaining.length === 0) {
						const re = new RegExp(`\\b${escapeRegex(importedVar)}\\b`, "g");
						collectMatches(text, re, uri, locations);
					} else {
						const re = buildVarPathRegex(importedVar, remaining);
						collectMatches(text, re, uri, locations);
					}
				}
			}
		}

		// Deduplicate by uri+offset
		return dedupeLocations(locations);
	}

	/**
	 * Find usages and group them by state formula name.
	 * State name is the first directory component under any stateRoot.
	 *  - /salt-states/nginx/init.sls → "nginx"
	 *  - /salt-states/nginx/files/x.jinja → "nginx"
	 *  - /salt-states/centrifugo/map.jinja → "centrifugo"
	 *
	 * Returns Map<stateName, Location[]>.
	 */
	async findUsagesByState(searchPath: string[]): Promise<Map<string, vscode.Location[]>> {
		const locations = await this.findUsages(searchPath);
		const stateRoots = getResolvedStateRoots();
		const result = new Map<string, vscode.Location[]>();
		for (const loc of locations) {
			const stateName = getStateName(loc.uri.fsPath, stateRoots);
			if (!stateName) continue;
			if (!result.has(stateName)) result.set(stateName, []);
			result.get(stateName)!.push(loc);
		}
		return result;
	}
}

function getStateName(filePath: string, stateRoots: string[]): string | null {
	for (const root of stateRoots) {
		if (filePath.startsWith(root + path.sep) || filePath === root) {
			const rel = filePath.substring(root.length + 1);
			const firstSlash = rel.indexOf(path.sep);
			return firstSlash >= 0 ? rel.substring(0, firstSlash) : rel.replace(/\.(sls|jinja|j2|jinja2)$/, "");
		}
	}
	return null;
}

interface FileEntry {
	mtimeMs: number;
	text: string;
	aliases: Map<string, string[]>;          // varName → pillar path (set X = pillar.Y)
	dictMaps: Map<string, Map<string, string[]>>; // varName → key → resolved pillar path
	imports: Map<string, string>;            // importedVarName → relative path string
}

/** Analyze file text once and extract aliases, dict maps, imports. */
function analyzeFile(text: string): { aliases: Map<string, string[]>; dictMaps: Map<string, Map<string, string[]>>; imports: Map<string, string> } {
	const aliases = findPillarAliases(text);
	const dictMaps = findDictMaps(text, aliases);
	const imports = findJinjaImports(text);
	return { aliases, dictMaps, imports };
}

/** Detect `{% set X = pillar.Y %}` aliases. */
function findPillarAliases(text: string): Map<string, string[]> {
	const aliases = new Map<string, string[]>();
	const setRe = /\{%-?\s*set\s+(\w+)\s*=\s*pillar((?:\.\w+|\[['"]?\w+['"]?\])+)/g;
	let m: RegExpExecArray | null;
	while ((m = setRe.exec(text)) !== null) {
		const varName = m[1];
		const chainStr = m[2];
		const path: string[] = [];
		const chainRe = /\.(\w+)|\[['"]?(\w+)['"]?\]/g;
		let cm: RegExpExecArray | null;
		while ((cm = chainRe.exec(chainStr)) !== null) {
			path.push(cm[1] || cm[2]);
		}
		if (path.length > 0) aliases.set(varName, path);
	}
	return aliases;
}

/**
 * Detect `{% set X = { 'k1': value1, 'k2': value2, ... } %}` patterns.
 * Resolves each value to a pillar path if possible (using local aliases).
 */
function findDictMaps(text: string, aliases: Map<string, string[]>): Map<string, Map<string, string[]>> {
	const result = new Map<string, Map<string, string[]>>();
	const startRe = /\{%-?\s*set\s+(\w+)\s*=\s*\{/g;
	let sm: RegExpExecArray | null;
	while ((sm = startRe.exec(text)) !== null) {
		const varName = sm[1];
		const dictStart = sm.index + sm[0].length;
		const dictEnd = findMatchingBrace(text, dictStart);
		if (dictEnd < 0) continue;
		const body = text.substring(dictStart, dictEnd);
		const map = parseDictBody(body, aliases);
		if (map.size > 0) result.set(varName, map);
	}
	return result;
}

/** Find the index just after the matching `}` for a dict body starting at `start` (inside the dict). */
function findMatchingBrace(text: string, start: number): number {
	let depth = 1;
	let inStr: string | null = null;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inStr) {
			if (c === inStr && text[i - 1] !== "\\") inStr = null;
			continue;
		}
		if (c === '"' || c === "'") { inStr = c; continue; }
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Parse a dict body, extracting key → resolved pillar path. */
function parseDictBody(body: string, aliases: Map<string, string[]>): Map<string, string[]> {
	const result = new Map<string, string[]>();
	// Each entry: 'KEY': VALUE_EXPR
	// Match key followed by chain expression starting with `pillar.X` or `aliasVar.X`
	const entryRe = /['"]?(\w+)['"]?\s*:\s*(\w+(?:\.\w+|\[['"]?\w+['"]?\])*)/g;
	let m: RegExpExecArray | null;
	while ((m = entryRe.exec(body)) !== null) {
		const key = m[1];
		const expr = m[2];
		const resolved = resolveChainExpr(expr, aliases);
		if (resolved) result.set(key, resolved);
	}
	return result;
}

/** Resolve a chain expression like `pillar.x.y` or `aliasVar.x` to a full pillar path. */
function resolveChainExpr(expr: string, aliases: Map<string, string[]>): string[] | null {
	const partsRe = /^(\w+)((?:\.\w+|\[['"]?\w+['"]?\])*)$/;
	const m = expr.match(partsRe);
	if (!m) return null;
	const head = m[1];
	const tail = m[2];
	const tailPath: string[] = [];
	const chainRe = /\.(\w+)|\[['"]?(\w+)['"]?\]/g;
	let cm: RegExpExecArray | null;
	while ((cm = chainRe.exec(tail)) !== null) {
		tailPath.push(cm[1] || cm[2]);
	}
	if (head === "pillar") {
		return tailPath;
	}
	const aliasPath = aliases.get(head);
	if (aliasPath) {
		return [...aliasPath, ...tailPath];
	}
	return null;
}

/** Detect `{% from "path/to.jinja" import VAR %}` and `{% from "..." import a, b, c %}`. */
function findJinjaImports(text: string): Map<string, string> {
	const imports = new Map<string, string>();
	const re = /\{%-?\s*from\s+["']([^"']+)["']\s+import\s+([\w,\s]+?)(?:\s+with\s+context)?\s*-?%\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const fromPath = m[1];
		const names = m[2].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
		for (const name of names) {
			imports.set(name, fromPath);
		}
	}
	return imports;
}

/** Resolve `from "X.jinja"` path against state roots, return matching file URI from known files. */
function resolveImport(importPath: string, stateRoots: string[], files: vscode.Uri[]): vscode.Uri | null {
	const fileSet = new Map<string, vscode.Uri>();
	for (const f of files) fileSet.set(f.fsPath, f);
	for (const root of stateRoots) {
		const candidate = path.join(root, importPath);
		const found = fileSet.get(candidate);
		if (found) return found;
	}
	return null;
}

function getResolvedStateRoots(): string[] {
	const config = vscode.workspace.getConfiguration("saltstack");
	const stateRoots = config.get<string[]>("stateRoots", ["salt", "srv/salt"]);
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const result: string[] = [];
	for (const root of stateRoots) {
		if (path.isAbsolute(root)) {
			result.push(root);
		} else {
			for (const folder of workspaceFolders) {
				result.push(path.join(folder.uri.fsPath, root));
			}
		}
	}
	return result;
}

function collectMatches(text: string, re: RegExp, uri: vscode.Uri, out: vscode.Location[]): void {
	re.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const lastChar = match[0][match[0].length - 1];
		if (lastChar !== "]" && lastChar !== "'" && lastChar !== '"') {
			const after = text[match.index + match[0].length];
			if (after && /[\w]/.test(after)) continue;
		}
		out.push(new vscode.Location(uri, offsetToPosition(text, match.index)));
	}
}

function buildPathRegex(path: string[]): RegExp {
	const partGroup = path.map((p) => {
		const e = escapeRegex(p);
		return `(?:\\.${e}|\\[["']${e}["']\\])`;
	}).join("");
	const chained = `pillar${partGroup}`;
	const colonPath = path.map(escapeRegex).join(":");
	const pillarGet = `pillar\\.get\\s*\\(\\s*["']${colonPath}(?=[:"'])`;
	const saltPillarGet = `salt\\[["']pillar\\.get["']\\]\\s*\\(\\s*["']${colonPath}(?=[:"'])`;
	return new RegExp(`(?:${chained}|${pillarGet}|${saltPillarGet})`, "g");
}

function buildVarPathRegex(varName: string, path: string[]): RegExp {
	const partGroup = path.map((p) => {
		const e = escapeRegex(p);
		return `(?:\\.${e}|\\[["']${e}["']\\])`;
	}).join("");
	return new RegExp(`\\b${escapeRegex(varName)}${partGroup}`, "g");
}

function isPrefix(prefix: string[], full: string[]): boolean {
	if (prefix.length > full.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (prefix[i] !== full[i]) return false;
	}
	return true;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function offsetToPosition(text: string, offset: number): vscode.Position {
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	return new vscode.Position(line, offset - lineStart);
}

function dedupeLocations(locs: vscode.Location[]): vscode.Location[] {
	const seen = new Set<string>();
	const result: vscode.Location[] = [];
	for (const loc of locs) {
		const key = `${loc.uri.fsPath}:${loc.range.start.line}:${loc.range.start.character}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(loc);
	}
	return result;
}
