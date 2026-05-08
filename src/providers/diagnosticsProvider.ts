import * as vscode from "vscode";
import { isPillarFile } from "../pillarContext";

/**
 * Linter for SLS files. Checks:
 *  - Duplicate state IDs
 *  - Empty state blocks (state ID with no module)
 *  - Jinja block mismatch (unclosed {% if %}, {% for %}, etc.)
 *  - Tabs used for indentation (Salt requires spaces)
 *  - Trailing whitespace
 *  - Inconsistent indentation (mixing 2-space and 4-space)
 *  - Requisite referencing non-existent state ID in the same file
 *  - Deprecated state module usage hints
 */
export class SaltDiagnosticsProvider implements vscode.Disposable {

	private diagnosticCollection: vscode.DiagnosticCollection;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("saltstack");

		// Lint on open
		if (vscode.window.activeTextEditor) {
			this.lintDocument(vscode.window.activeTextEditor.document);
		}

		// Lint on file open
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor) this.lintDocument(editor.document);
			}),
		);

		// Lint on save
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument((doc) => {
				this.lintDocument(doc);
			}),
		);

		// Lint on change (debounced)
		let timer: ReturnType<typeof setTimeout> | undefined;
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => this.lintDocument(e.document), 500);
			}),
		);

		// Clear diagnostics on file close
		this.disposables.push(
			vscode.workspace.onDidCloseTextDocument((doc) => {
				this.diagnosticCollection.delete(doc.uri);
			}),
		);
	}

	lintDocument(document: vscode.TextDocument): void {
		if (document.languageId !== "sls" && !document.languageId.startsWith("jinja")) return;

		const config = vscode.workspace.getConfiguration("saltstack.lint");
		if (!config.get<boolean>("enabled", true)) {
			this.diagnosticCollection.delete(document.uri);
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];

		if (config.get<boolean>("tabs", true)) {
			this.checkTabs(document, diagnostics);
		}
		if (config.get<boolean>("trailingWhitespace", true)) {
			this.checkTrailingWhitespace(document, diagnostics);
		}
		if (config.get<boolean>("jinjaBlocks", true)) {
			this.checkJinjaBlocks(document, diagnostics);
		}

		// Duplicate top-level keys are bad in both state and pillar files
		if (document.languageId === "sls" && config.get<boolean>("duplicateStateIds", true)) {
			this.checkDuplicateStateIds(document, diagnostics);
		}

		if (document.languageId === "sls" && !isPillarFile(document)) {
			this.checkEmptyStateBlocks(document, diagnostics);
			this.checkRequisiteRefs(document, diagnostics);
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	/** Tabs in YAML/SLS cause parse errors */
	private checkTabs(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			const tabIndex = line.text.indexOf("\t");
			if (tabIndex !== -1 && !this.isInsideJinjaComment(document, i)) {
				const range = new vscode.Range(i, tabIndex, i, tabIndex + 1);
				diagnostics.push(
					new vscode.Diagnostic(
						range,
						"Tab character found. Salt/YAML requires spaces for indentation.",
						vscode.DiagnosticSeverity.Error,
					),
				);
			}
		}
	}

	/** Trailing whitespace */
	private checkTrailingWhitespace(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			const match = line.text.match(/(\s+)$/);
			if (match && line.text.trim().length > 0) {
				const start = line.text.length - match[1].length;
				const range = new vscode.Range(i, start, i, line.text.length);
				diagnostics.push(
					new vscode.Diagnostic(
						range,
						"Trailing whitespace",
						vscode.DiagnosticSeverity.Hint,
					),
				);
			}
		}
	}

	/** Duplicate top-level keys (state IDs in state files, pillar keys in pillar files). */
	private checkDuplicateStateIds(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		const stateIds = new Map<string, number[]>();
		// Match top-level keys with or without inline values: "key:" or "key: value"
		const stateIdRe = /^([a-zA-Z_][\w.\-/() ]*):(?:\s|$)/;

		// Track Jinja branching depth to detect IDs in separate if/elif/else branches
		// Each ID gets a "branch signature" — IDs in different branches are not duplicates
		const branchStack: number[] = [0]; // stack of branch counters
		let branchId = 0;
		const stateIdBranches = new Map<string, Map<string, number[]>>(); // id -> (branchSig -> lines)

		for (let i = 0; i < document.lineCount; i++) {
			const text = document.lineAt(i).text;
			const trimmed = text.trimStart();

			// Track Jinja if/elif/else/endif to build branch signatures
			if (trimmed.match(/\{%-?\s*(if)\b/)) {
				branchStack.push(0);
				branchId++;
			} else if (trimmed.match(/\{%-?\s*(elif|else)\b/)) {
				// Same nesting level, new branch
				if (branchStack.length > 0) {
					branchStack[branchStack.length - 1]++;
					branchId++;
				}
			} else if (trimmed.match(/\{%-?\s*endif\b/)) {
				if (branchStack.length > 1) {
					branchStack.pop();
				}
			}

			// Skip Jinja lines for state ID detection
			if (trimmed.startsWith("{%") || trimmed.startsWith("{{")) continue;

			const match = text.match(stateIdRe);
			if (match) {
				const id = match[1];
				const sig = branchStack.join(".");

				if (!stateIdBranches.has(id)) {
					stateIdBranches.set(id, new Map());
				}
				const branches = stateIdBranches.get(id)!;
				if (!branches.has(sig)) {
					branches.set(sig, []);
				}
				branches.get(sig)!.push(i);

				// Also collect flat list for overall tracking
				if (!stateIds.has(id)) {
					stateIds.set(id, []);
				}
				stateIds.get(id)!.push(i);
			}
		}

		for (const [id, lines] of stateIds) {
			if (lines.length <= 1) continue;

			// Check if all occurrences are in different Jinja branches
			const branches = stateIdBranches.get(id)!;
			const allInDifferentBranches = Array.from(branches.values()).every((ls) => ls.length <= 1);

			if (allInDifferentBranches) continue; // Skip — they're in separate if/else branches

			// Real duplicates — report them
			for (const lineNum of lines) {
				const range = new vscode.Range(lineNum, 0, lineNum, id.length);
				const diag = new vscode.Diagnostic(
					range,
					`Duplicate state ID "${id}" (also on line${lines.length > 2 ? "s" : ""} ${lines.filter((l) => l !== lineNum).map((l) => l + 1).join(", ")})`,
					vscode.DiagnosticSeverity.Error,
				);
				diag.source = "saltstack";
				diagnostics.push(diag);
			}
		}
	}

	/** State ID without any module call underneath */
	private checkEmptyStateBlocks(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		const stateIdRe = /^([a-zA-Z_][\w.\-/() ]*):$/;
		const moduleRe = /^\s+[\w]+\.[\w]+:/;

		for (let i = 0; i < document.lineCount; i++) {
			const text = document.lineAt(i).text;
			if (text.trimStart().startsWith("{%") || text.trimStart().startsWith("{{")) continue;
			const match = text.match(stateIdRe);
			if (!match) continue;

			// Check if next non-empty, non-jinja line is a state module
			let hasModule = false;
			for (let j = i + 1; j < document.lineCount; j++) {
				const nextText = document.lineAt(j).text;
				if (nextText.trim() === "") continue;
				if (nextText.trimStart().startsWith("{%") || nextText.trimStart().startsWith("{#")) continue;
				// If it's another state ID at root level, the previous block is empty
				if (stateIdRe.test(nextText)) break;
				// If it's "include:" block at root level
				if (/^[a-zA-Z]/.test(nextText)) break;
				if (moduleRe.test(nextText)) {
					hasModule = true;
					break;
				}
				// Some other indented content counts as non-empty
				if (/^\s+/.test(nextText)) {
					hasModule = true;
					break;
				}
			}

			if (!hasModule) {
				const range = new vscode.Range(i, 0, i, match[1].length);
				diagnostics.push(
					new vscode.Diagnostic(
						range,
						`State ID "${match[1]}" has no state module call`,
						vscode.DiagnosticSeverity.Warning,
					),
				);
			}
		}
	}

	/** Unclosed Jinja blocks */
	private checkJinjaBlocks(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		const blockStack: { keyword: string; line: number }[] = [];
		const openers = ["for", "if", "block", "macro", "call", "filter", "raw", "set"];
		const closers = ["endfor", "endif", "endblock", "endmacro", "endcall", "endfilter", "endraw", "endset"];
		const closerToOpener: Record<string, string> = {
			endfor: "for", endif: "if", endblock: "block", endmacro: "macro",
			endcall: "call", endfilter: "filter", endraw: "raw", endset: "set",
		};

		// "elif" and "else" don't push/pop, they're just midblock
		const tagRe = /\{%-?\s*(\w+)/g;

		for (let i = 0; i < document.lineCount; i++) {
			const text = document.lineAt(i).text;
			let match: RegExpExecArray | null;
			tagRe.lastIndex = 0;
			while ((match = tagRe.exec(text)) !== null) {
				const kw = match[1];
				if (openers.includes(kw)) {
					// `set` has two forms:
					//   - Assignment: {% set X = expr %} — single tag, NO endset needed
					//   - Block:      {% set X %}...{% endset %} — multi-tag, endset required
					// Distinguish by looking for `=` between `set NAME` and the closing `%}`.
					if (kw === "set" && isAssignmentSet(text, match.index)) {
						continue;
					}
					blockStack.push({ keyword: kw, line: i });
				} else if (closers.includes(kw)) {
					const expected = closerToOpener[kw];
					if (blockStack.length === 0) {
						const range = new vscode.Range(i, match.index, i, match.index + match[0].length);
						diagnostics.push(
							new vscode.Diagnostic(
								range,
								`Unexpected {%- ${kw} %} — no matching {%- ${expected} %}`,
								vscode.DiagnosticSeverity.Error,
							),
						);
					} else {
						const top = blockStack[blockStack.length - 1];
						if (top.keyword === expected) {
							blockStack.pop();
						} else {
							const range = new vscode.Range(i, match.index, i, match.index + match[0].length);
							diagnostics.push(
								new vscode.Diagnostic(
									range,
									`Mismatched block: expected {%- end${top.keyword} %} but got {%- ${kw} %}`,
									vscode.DiagnosticSeverity.Error,
								),
							);
							blockStack.pop();
						}
					}
				}
			}
		}

		// Any remaining unclosed blocks
		for (const block of blockStack) {
			const line = document.lineAt(block.line);
			const range = new vscode.Range(block.line, 0, block.line, line.text.length);
			diagnostics.push(
				new vscode.Diagnostic(
					range,
					`Unclosed {%- ${block.keyword} %} block — missing {%- end${block.keyword} %}`,
					vscode.DiagnosticSeverity.Error,
				),
			);
		}
	}

	private checkRequisiteRefs(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		const lines: string[] = [];
		for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);
		const issues = findUnknownRequisiteRefs(lines);
		for (const issue of issues) {
			const range = new vscode.Range(issue.line, issue.startCol, issue.line, issue.endCol);
			diagnostics.push(
				new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Information),
			);
		}
	}

	private isInsideJinjaComment(document: vscode.TextDocument, line: number): boolean {
		const text = document.lineAt(line).text;
		return text.includes("{#") || text.includes("#}");
	}

	dispose(): void {
		this.diagnosticCollection.dispose();
		for (const d of this.disposables) d.dispose();
	}
}

/**
 * Decide if `{% set ... %}` at `tagStart` in `text` is an assignment form
 * (no endset needed) vs a block form (`{% set NAME %}...{% endset %}`).
 *
 * Heuristic: look between `set NAME` and the closing `%}` (or `-%}`); if there
 * is an `=` it's an assignment. Block-form `{% set NAME %}` and `{%- set NAME -%}`
 * don't have `=` and need a matching `endset`.
 *
 * Exported for unit testing.
 */
export function isAssignmentSet(text: string, tagStart: number): boolean {
	const tail = text.substring(tagStart);
	const setNameMatch = tail.match(/^\{%-?\s*set\s+\w+/);
	if (!setNameMatch) return false; // malformed, treat as block (won't match endset, will report)
	const afterName = tail.substring(setNameMatch[0].length);
	// Look only inside the same tag (up to `%}` or `-%}`)
	const closeIdx = afterName.search(/-?%\}/);
	const checkRange = closeIdx >= 0 ? afterName.substring(0, closeIdx) : afterName;
	return checkRange.includes("=");
}

export interface RequisiteIssue {
	line: number;
	startCol: number;
	endCol: number;
	message: string;
}

/**
 * Find requisite references that don't match a top-level state ID in this file.
 *
 * Handles:
 *   - flexible indentation (no hardcoded 6-space requirement)
 *   - typed requisites:  `- file: state_id`  (typed refs that look like a path
 *                        or fully-qualified name are skipped — they target
 *                        cross-formula state names, not local state IDs)
 *   - skips paths (anything with `/` or starting with `.`)
 *   - skips Jinja-templated refs
 *
 * Pure function for unit testing.
 */
export function findUnknownRequisiteRefs(lines: string[]): RequisiteIssue[] {
	const stateIds = new Set<string>();
	const stateIdRe = /^([a-zA-Z_][\w.\-/() ]*):(?:\s|$)/;
	for (const text of lines) {
		if (text.trimStart().startsWith("{%")) continue;
		const m = text.match(stateIdRe);
		if (m) stateIds.add(m[1]);
	}

	const requisiteHeaderRe = /^(\s+)-\s+(?:require|watch|onchanges|onfail|prereq|listen|use|require_in|watch_in|onchanges_in|onfail_in|prereq_in|listen_in)(?:_any)?:\s*$/;
	const entryRe = /^(\s+)-\s+(?:(\w+):\s+)?([\w][\w.\-/() ]*)\s*$/;

	const issues: RequisiteIssue[] = [];
	let requisiteIndent = -1;

	for (let i = 0; i < lines.length; i++) {
		const text = lines[i];
		if (text.trim() === "") continue;

		const headerMatch = text.match(requisiteHeaderRe);
		if (headerMatch) {
			requisiteIndent = headerMatch[1].length;
			continue;
		}
		if (requisiteIndent < 0) continue;

		const indent = text.length - text.trimStart().length;
		if (indent <= requisiteIndent) {
			requisiteIndent = -1;
			const nextHeader = text.match(requisiteHeaderRe);
			if (nextHeader) requisiteIndent = nextHeader[1].length;
			continue;
		}

		const entryMatch = text.match(entryRe);
		if (!entryMatch) continue;

		const moduleType = entryMatch[2];
		const ref = entryMatch[3].trim();

		if (ref.includes("{{") || ref.includes("{%")) continue;
		// Typed requisites (`- file: foo`, `- pkg: nginx`, etc.) target a state's
		// `name:` parameter and routinely cross formula boundaries — skip entirely.
		if (moduleType) continue;
		// Untyped path-like refs (`- /etc/foo`, `- .substate`) aren't local state IDs.
		if (ref.startsWith(".") || ref.includes("/")) continue;

		if (!stateIds.has(ref)) {
			const startCol = text.indexOf(ref, indent);
			issues.push({
				line: i,
				startCol,
				endCol: startCol + ref.length,
				message: `State ID "${ref}" not found in this file (could be from an included SLS)`,
			});
		}
	}
	return issues;
}
