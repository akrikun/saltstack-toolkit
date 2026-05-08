import * as vscode from "vscode";
import * as fs from "fs/promises";
import { WorkspaceStateIndex } from "../workspaceIndex";

/**
 * "Find All References" for state IDs and pillar keys (when the cursor sits on
 * a state-ID declaration line, return everywhere it's referenced as a
 * requisite target across the workspace).
 */
export class SaltReferenceProvider implements vscode.ReferenceProvider {

	constructor(private workspaceIndex: WorkspaceStateIndex) {}

	async provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Location[] | null> {
		const line = document.lineAt(position).text;
		// Cursor on a top-level state ID declaration: "key:" or "key: value"
		const idMatch = line.match(/^([a-zA-Z_][\w.\-/() ]*):(?:\s|$)/);
		if (!idMatch) return null;
		const wordRange = document.getWordRangeAtPosition(position, /[\w.\-/() ]+/);
		if (!wordRange) return null;
		const word = document.getText(wordRange).trim();
		if (word !== idMatch[1]) return null;

		return findReferencesAcrossWorkspace(idMatch[1], this.workspaceIndex);
	}
}

/**
 * Search every state file for requisite entries that reference `stateId`.
 * Matches both untyped (`- foo`) and typed (`- file: foo`) forms.
 *
 * Pure function (modulo file IO) for testability.
 */
export async function findReferencesAcrossWorkspace(
	stateId: string,
	index: WorkspaceStateIndex,
): Promise<vscode.Location[]> {
	const fileEntries = await index.getFileEntries();
	const escaped = escapeRegex(stateId);
	// Anchored at line start with leading whitespace+dash, optional typed prefix.
	const refRe = new RegExp(`^\\s+-\\s+(?:\\w+:\\s+)?${escaped}\\s*$`);
	const out: vscode.Location[] = [];
	for (const filePath of fileEntries.keys()) {
		let text: string;
		try { text = await fs.readFile(filePath, "utf8"); } catch { continue; }
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (refRe.test(lines[i])) {
				const col = lines[i].indexOf(stateId);
				if (col >= 0) {
					out.push(new vscode.Location(
						vscode.Uri.file(filePath),
						new vscode.Position(i, col),
					));
				}
			}
		}
	}
	return out;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
