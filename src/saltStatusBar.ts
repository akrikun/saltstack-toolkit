import * as vscode from "vscode";
import * as path from "path";

/**
 * Status bar item showing which configured Salt root the active file lives
 * under. Helps disambiguate when multiple state/pillar roots are configured.
 */
export class SaltStatusBar {
	private item: vscode.StatusBarItem;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.command = "saltstack.reindexWorkspace";
		this.item.tooltip = "Click to reindex SaltStack workspace";

		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.update()),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("saltstack.stateRoots") || e.affectsConfiguration("saltstack.pillarRoots")) {
					this.update();
				}
			}),
		);
		this.update();
	}

	dispose(): void {
		this.item.dispose();
		for (const d of this.disposables) d.dispose();
	}

	private update(): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			this.item.hide();
			return;
		}
		const lang = editor.document.languageId;
		if (lang !== "sls" && !lang.startsWith("jinja")) {
			this.item.hide();
			return;
		}
		const filePath = editor.document.uri.fsPath;
		const config = vscode.workspace.getConfiguration("saltstack");
		const stateRoots = config.get<string[]>("stateRoots", ["salt", "srv/salt"]);
		const pillarRoots = config.get<string[]>("pillarRoots", ["pillar", "srv/pillar"]);
		const wsFolders = vscode.workspace.workspaceFolders ?? [];

		const match = matchRoot(filePath, [...stateRoots, ...pillarRoots], wsFolders.map((f) => f.uri.fsPath));
		if (match) {
			const kind = stateRoots.includes(match.root) ? "state" : "pillar";
			this.item.text = `$(symbol-folder) Salt ${kind}: ${path.basename(match.root)}`;
			this.item.show();
		} else {
			this.item.text = `$(question) Salt root: unknown`;
			this.item.show();
		}
	}
}

interface RootMatch { root: string }

/** Pure: which configured root contains `filePath`? */
export function matchRoot(filePath: string, roots: string[], workspaceFolders: string[]): RootMatch | null {
	for (const root of roots) {
		const candidates: string[] = [];
		if (path.isAbsolute(root)) candidates.push(root);
		else for (const folder of workspaceFolders) candidates.push(path.join(folder, root));
		for (const candidate of candidates) {
			if (filePath.startsWith(candidate + path.sep)) return { root };
		}
	}
	return null;
}
