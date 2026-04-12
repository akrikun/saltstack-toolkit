import * as vscode from "vscode";

/**
 * Provides document symbols (Outline view / Cmd+Shift+O) for SLS files.
 * Extracts:
 *  - State IDs (top-level YAML keys)
 *  - State modules (e.g. file.managed, service.running)
 *  - include blocks
 */
export class SaltDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

	// Top-level state ID: word chars, dots, dashes, slashes at the start of line ending with ":"
	private static readonly STATE_ID_RE = /^([a-zA-Z_][\w.\-/() ]*):$/;
	// State module call: indented "module.function:" pattern
	private static readonly STATE_MODULE_RE = /^(\s+)([\w]+\.[\w]+):\s*$/;
	// Include block
	private static readonly INCLUDE_RE = /^include:\s*$/;
	// Include entry: "  - .substate" or "  - formula.substate"
	private static readonly INCLUDE_ENTRY_RE = /^\s+-\s+(\.?[\w./\-]+)\s*$/;
	// Jinja from import
	private static readonly JINJA_IMPORT_RE = /\{%[-\s]*from\s+["']([^"']+)["']\s+import\s+([\w,\s]+)\s+with\s+context/;
	// Jinja set variable
	private static readonly JINJA_SET_RE = /\{%-?\s*set\s+([\w]+)\s*=/;

	provideDocumentSymbols(
		document: vscode.TextDocument,
	): vscode.DocumentSymbol[] {
		const symbols: vscode.DocumentSymbol[] = [];
		let currentStateId: vscode.DocumentSymbol | null = null;
		let inInclude = false;
		let includeSymbol: vscode.DocumentSymbol | null = null;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			const text = line.text;

			// Skip empty lines and pure Jinja lines for state structure
			if (text.trim() === "") {
				if (inInclude && includeSymbol) {
					// End include block on empty line
					includeSymbol.range = new vscode.Range(includeSymbol.range.start, line.range.end);
					inInclude = false;
				}
				continue;
			}

			// Jinja imports
			const importMatch = text.match(SaltDocumentSymbolProvider.JINJA_IMPORT_RE);
			if (importMatch) {
				const [, path, vars] = importMatch;
				const sym = new vscode.DocumentSymbol(
					`import ${vars.trim()} from ${path}`,
					"",
					vscode.SymbolKind.Module,
					line.range,
					line.range,
				);
				symbols.push(sym);
				continue;
			}

			// Jinja set top-level variables
			const setMatch = text.match(SaltDocumentSymbolProvider.JINJA_SET_RE);
			if (setMatch && !text.startsWith(" ") && !text.startsWith("\t")) {
				// Only top-level sets (not inside blocks)
				const sym = new vscode.DocumentSymbol(
					setMatch[1],
					"variable",
					vscode.SymbolKind.Variable,
					line.range,
					line.range,
				);
				symbols.push(sym);
				continue;
			}

			// Include block
			if (SaltDocumentSymbolProvider.INCLUDE_RE.test(text)) {
				inInclude = true;
				includeSymbol = new vscode.DocumentSymbol(
					"include",
					"",
					vscode.SymbolKind.Package,
					line.range,
					line.range,
				);
				symbols.push(includeSymbol);
				continue;
			}

			// Include entries
			if (inInclude && includeSymbol) {
				const entryMatch = text.match(SaltDocumentSymbolProvider.INCLUDE_ENTRY_RE);
				if (entryMatch) {
					const child = new vscode.DocumentSymbol(
						entryMatch[1],
						"",
						vscode.SymbolKind.File,
						line.range,
						line.range,
					);
					includeSymbol.children.push(child);
					includeSymbol.range = new vscode.Range(includeSymbol.range.start, line.range.end);
					continue;
				}
				// If line doesn't match include entry and isn't a Jinja tag, end include
				if (!text.trim().startsWith("{%")) {
					inInclude = false;
				}
			}

			// State ID (top-level key)
			const stateIdMatch = text.match(SaltDocumentSymbolProvider.STATE_ID_RE);
			if (stateIdMatch) {
				// Close previous state ID range
				if (currentStateId) {
					const prevEnd = document.lineAt(Math.max(0, i - 1)).range.end;
					currentStateId.range = new vscode.Range(currentStateId.range.start, prevEnd);
				}

				currentStateId = new vscode.DocumentSymbol(
					stateIdMatch[1],
					"",
					vscode.SymbolKind.Key,
					line.range,
					line.range,
				);
				symbols.push(currentStateId);
				continue;
			}

			// State module (child of state ID)
			const moduleMatch = text.match(SaltDocumentSymbolProvider.STATE_MODULE_RE);
			if (moduleMatch && currentStateId) {
				const child = new vscode.DocumentSymbol(
					moduleMatch[2],
					"",
					vscode.SymbolKind.Function,
					line.range,
					line.range,
				);
				currentStateId.children.push(child);
			}
		}

		// Close last state ID
		if (currentStateId) {
			const lastLine = document.lineAt(document.lineCount - 1);
			currentStateId.range = new vscode.Range(currentStateId.range.start, lastLine.range.end);
		}

		return symbols;
	}
}
