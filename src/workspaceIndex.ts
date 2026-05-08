import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

/**
 * Project-wide index of state IDs declared anywhere under `stateRoots`.
 *
 * Built lazily on first query; refreshed by file-system events. Each entry
 * records the file URI and the line where the ID is defined.
 */
export class WorkspaceStateIndex {
	private indexCache: Map<string, StateEntry[]> | null = null;
	private fileEntriesCache = new Map<string, StateEntry[]>(); // per-file cache for reverse lookups
	private watchers: vscode.Disposable[] = [];
	private readonly _onDidUpdate = new vscode.EventEmitter<void>();
	readonly onDidUpdate = this._onDidUpdate.event;

	constructor() {
		this.watchers.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("saltstack.stateRoots")) {
					this.invalidate();
				}
			}),
		);
		const fsWatcher = vscode.workspace.createFileSystemWatcher("**/*.{sls,tst}");
		fsWatcher.onDidChange(() => this.invalidate());
		fsWatcher.onDidCreate(() => this.invalidate());
		fsWatcher.onDidDelete(() => this.invalidate());
		this.watchers.push(fsWatcher);
		this.watchers.push(
			vscode.workspace.onDidSaveTextDocument(() => this.invalidate()),
		);
	}

	dispose(): void {
		for (const w of this.watchers) w.dispose();
		this._onDidUpdate.dispose();
	}

	invalidate(): void {
		this.indexCache = null;
		this.fileEntriesCache.clear();
		this._onDidUpdate.fire();
	}

	/** Force a fresh scan. */
	async reindex(): Promise<void> {
		this.invalidate();
		await this.getIndex();
	}

	/** Find every location where `stateId` is declared in the workspace. */
	async findStateIdDeclarations(stateId: string): Promise<vscode.Location[]> {
		const idx = await this.getIndex();
		const entries = idx.get(stateId) ?? [];
		return entries.map((e) => new vscode.Location(e.uri, new vscode.Position(e.line, 0)));
	}

	/** Return all state IDs declared anywhere in the workspace. */
	async allStateIds(): Promise<Set<string>> {
		return new Set((await this.getIndex()).keys());
	}

	/** Return entries grouped by file URI (for find-usages reverse lookup). */
	async getFileEntries(): Promise<Map<string, StateEntry[]>> {
		await this.getIndex();
		return this.fileEntriesCache;
	}

	private async getIndex(): Promise<Map<string, StateEntry[]>> {
		if (this.indexCache) return this.indexCache;
		const idx = new Map<string, StateEntry[]>();
		this.fileEntriesCache.clear();

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

		const seenFiles = new Set<string>();
		for (const base of bases) {
			const pattern = new vscode.RelativePattern(base, "**/*.{sls,tst}");
			const files = await vscode.workspace.findFiles(pattern);
			for (const uri of files) {
				if (seenFiles.has(uri.fsPath)) continue;
				seenFiles.add(uri.fsPath);
				let text: string;
				try {
					text = await fs.readFile(uri.fsPath, "utf8");
				} catch {
					continue;
				}
				const fileEntries: StateEntry[] = [];
				for (const entry of extractStateIds(text, uri)) {
					fileEntries.push(entry);
					const list = idx.get(entry.stateId);
					if (list) list.push(entry);
					else idx.set(entry.stateId, [entry]);
				}
				if (fileEntries.length > 0) this.fileEntriesCache.set(uri.fsPath, fileEntries);
			}
		}

		this.indexCache = idx;
		return idx;
	}
}

export interface StateEntry {
	stateId: string;
	uri: vscode.Uri;
	line: number;
}

/**
 * Extract top-level state IDs from `text`. A state ID is a line of the form
 * `key:` (optionally followed by an inline value) at indent 0, where `key`
 * begins with a letter/underscore. Skips Jinja-only lines and lines inside
 * `include:` blocks.
 *
 * Pure function for testability.
 */
export function extractStateIds(text: string, uri: vscode.Uri): StateEntry[] {
	const out: StateEntry[] = [];
	const stateIdRe = /^([a-zA-Z_][\w.\-/() ]*):(?:\s|$)/;
	const lines = text.split("\n");
	let inInclude = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trimStart();
		if (trimmed.startsWith("{%") || trimmed.startsWith("{{") || trimmed.startsWith("#")) continue;
		// `include:` block — skip until indent returns to 0
		if (line === "include:" || line.startsWith("include:")) {
			inInclude = true;
			continue;
		}
		if (inInclude) {
			if (line.startsWith(" ") || line.startsWith("\t") || line === "") continue;
			inInclude = false;
		}
		const match = line.match(stateIdRe);
		if (!match) continue;
		const id = match[1];
		// Filter out a few reserved YAML/Salt structural keys that aren't state IDs
		if (id === "include" || id === "extend" || id === "exclude") continue;
		out.push({ stateId: id, uri, line: i });
	}
	return out;
}
