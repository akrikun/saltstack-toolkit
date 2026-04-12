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
