import * as vscode from "vscode";
import * as path from "path";

/**
 * Determines whether a document lives inside one of the configured pillar roots.
 * Used to switch behavior in hover, completion, and definition providers.
 */
export function isPillarFile(document: vscode.TextDocument): boolean {
	const config = vscode.workspace.getConfiguration("saltstack");
	const pillarRoots = config.get<string[]>("pillarRoots", ["pillar", "srv/pillar"]);
	const filePath = document.uri.fsPath;

	// Check absolute paths
	for (const root of pillarRoots) {
		if (path.isAbsolute(root) && filePath.startsWith(root + path.sep)) {
			return true;
		}
	}

	// Check relative to workspace folders
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		for (const folder of workspaceFolders) {
			for (const root of pillarRoots) {
				if (!path.isAbsolute(root)) {
					const absRoot = path.join(folder.uri.fsPath, root);
					if (filePath.startsWith(absRoot + path.sep)) {
						return true;
					}
				}
			}
		}
	}

	// Heuristic: path contains "pillar" directory segment
	const segments = filePath.split(path.sep);
	return segments.some((s) => s === "pillar" || s === "pillars" || s.includes("pillar"));
}

/**
 * Build the YAML key path for the cursor position by walking up indentation.
 * E.g. for cursor on "site:" inside "netbox: > data: > site:" returns ["netbox", "data", "site"].
 * Returns null if cursor is not on a key.
 */
export function getPillarKeyPath(document: vscode.TextDocument, position: vscode.Position): string[] | null {
	const currentLine = document.lineAt(position.line);
	const text = currentLine.text;
	const trimmed = text.trimStart();
	const indent = text.length - trimmed.length;

	const keyMatch = trimmed.match(/^([\w][\w.\-]*):/);
	if (!keyMatch) return null;

	const keyStart = indent;
	const keyEnd = keyStart + keyMatch[1].length;
	if (position.character < keyStart || position.character > keyEnd) return null;

	const path: string[] = [keyMatch[1]];
	let targetIndent = indent;
	for (let i = position.line - 1; i >= 0; i--) {
		const line = document.lineAt(i);
		if (line.isEmptyOrWhitespace) continue;
		const lineTrim = line.text.trimStart();
		if (lineTrim.startsWith("#") || lineTrim.startsWith("{%") || lineTrim.startsWith("{#")) continue;
		const lineIndent = line.text.length - lineTrim.length;
		if (lineIndent >= targetIndent) continue;
		const m = lineTrim.match(/^([\w][\w.\-]*):/);
		if (!m) continue;
		path.unshift(m[1]);
		targetIndent = lineIndent;
		if (lineIndent === 0) break;
	}
	return path;
}

/**
 * Resolve a pillar-relative include path to absolute file URIs.
 * E.g. "defaults/platform.sls" -> [Uri to the file in pillarRoots]
 */
export async function resolvePillarPath(targetPath: string): Promise<vscode.Uri[]> {
	const config = vscode.workspace.getConfiguration("saltstack");
	const pillarRoots = config.get<string[]>("pillarRoots", ["pillar", "srv/pillar"]);
	const results: vscode.Uri[] = [];

	for (const root of pillarRoots) {
		let candidates: vscode.Uri[];
		if (path.isAbsolute(root)) {
			candidates = [vscode.Uri.file(path.join(root, targetPath))];
		} else {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) continue;
			candidates = workspaceFolders.map((f) =>
				vscode.Uri.file(path.join(f.uri.fsPath, root, targetPath)),
			);
		}

		for (const uri of candidates) {
			try {
				await vscode.workspace.fs.stat(uri);
				results.push(uri);
			} catch {
				// not found, skip
			}
		}
	}

	return results;
}
