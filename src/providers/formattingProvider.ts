import * as vscode from "vscode";

/**
 * Formatting provider for SLS files.
 * Handles:
 *  - Remove trailing whitespace
 *  - Ensure final newline
 *  - Normalize indentation (tabs → 2 spaces)
 *  - Normalize Jinja tag spacing: {% tag %}, {{ var }}, {# comment #}
 *  - Ensure single blank line between state blocks
 *  - Trim multiple consecutive blank lines to one
 */
export class SaltFormattingProvider implements vscode.DocumentFormattingEditProvider {

	provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
	): vscode.TextEdit[] {
		const edits: vscode.TextEdit[] = [];
		const indentStr = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			let text = line.text;
			let changed = false;

			// 1. Tabs → spaces (in leading whitespace only)
			if (options.insertSpaces) {
				const leadingTabs = text.match(/^(\t+)/);
				if (leadingTabs) {
					const spaces = leadingTabs[1].replace(/\t/g, indentStr);
					text = spaces + text.substring(leadingTabs[1].length);
					changed = true;
				}
			}

			// 2. Trailing whitespace
			const trimmed = text.replace(/\s+$/, "");
			if (trimmed !== text) {
				text = trimmed;
				changed = true;
			}

			// 3. Normalize Jinja tag spacing
			//    "{{-var}}" → "{{- var }}"
			//    "{%if x%}" → "{% if x %}"
			//    "{#comment#}" → "{# comment #}"
			const jinjaFixed = this.normalizeJinjaTags(text);
			if (jinjaFixed !== text) {
				text = jinjaFixed;
				changed = true;
			}

			if (changed) {
				edits.push(vscode.TextEdit.replace(line.range, text));
			}
		}

		// 4. Trim multiple consecutive blank lines to max 1
		let consecutiveBlanks = 0;
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			if (line.isEmptyOrWhitespace) {
				consecutiveBlanks++;
				if (consecutiveBlanks > 1) {
					// Delete this line
					const deleteRange = new vscode.Range(
						i - 1, document.lineAt(i - 1).text.length,
						i, line.text.length,
					);
					edits.push(vscode.TextEdit.delete(deleteRange));
				}
			} else {
				consecutiveBlanks = 0;
			}
		}

		// 5. Ensure final newline
		if (document.lineCount > 0) {
			const lastLine = document.lineAt(document.lineCount - 1);
			if (lastLine.text.length > 0) {
				edits.push(vscode.TextEdit.insert(
					new vscode.Position(document.lineCount - 1, lastLine.text.length),
					"\n",
				));
			}
		}

		return edits;
	}

	private normalizeJinjaTags(text: string): string {
		// Don't touch anything inside {# ... #} comments — preserve as-is
		// Strategy: split text into comment and non-comment segments, only format non-comment parts

		const segments: { text: string; isComment: boolean }[] = [];
		let remaining = text;

		while (remaining.length > 0) {
			const commentStart = remaining.indexOf("{#");
			if (commentStart === -1) {
				segments.push({ text: remaining, isComment: false });
				break;
			}

			// Push everything before the comment
			if (commentStart > 0) {
				segments.push({ text: remaining.substring(0, commentStart), isComment: false });
			}

			// Find the end of the comment
			const commentEnd = remaining.indexOf("#}", commentStart + 2);
			if (commentEnd === -1) {
				// Unclosed comment — push the rest as comment
				segments.push({ text: remaining.substring(commentStart), isComment: true });
				break;
			}

			segments.push({ text: remaining.substring(commentStart, commentEnd + 2), isComment: true });
			remaining = remaining.substring(commentEnd + 2);
		}

		// Only normalize non-comment segments
		return segments.map((seg) => {
			if (seg.isComment) return seg.text;
			return this.normalizeJinjaExpressions(seg.text);
		}).join("");
	}

	private normalizeJinjaExpressions(text: string): string {
		const config = vscode.workspace.getConfiguration("saltstack.format");
		const enforceDash = config.get<boolean>("enforceDashTags", true);

		// {% ... %} — tags
		// enforceDash: convert opening {% → {%- (but preserve existing -%} on closing)
		// Closing -%} is ALWAYS preserved if present — it controls output whitespace
		if (enforceDash) {
			// Opening: always add dash: "{% if" / "{%if" → "{%- if"
			text = text.replace(/\{%-?\s*(?![\s%])/g, "{%- ");
		} else {
			// Only fix spacing, preserve existing dash
			text = text.replace(/\{%(-?)\s*(?![\s%])/g, (_, dash) => dash ? "{%- " : "{% ");
		}
		// Closing: preserve existing dash, only fix spacing
		// "x%}" → "x %}", "x-%}" → "x -%}", "x -%}" stays
		text = text.replace(/(?<![%\s])\s*(-?)%\}/g, (_, dash) => dash ? " -%}" : " %}");

		// {{ ... }} — variable output (preserve existing dashes, only fix spacing)
		text = text.replace(/\{\{(-?)\s*(?![\s}])/g, (_, dash) => dash ? "{{- " : "{{ ");
		text = text.replace(/(?<![{\s])\s*(-?)\}\}/g, (_, dash) => dash ? " -}}" : " }}");

		// Clean up multiple spaces inside tags
		text = text.replace(/(\{\{-?\s)\s+/g, "$1");
		text = text.replace(/\s\s+((-?)?\}\})/g, " $1");
		text = text.replace(/(\{%-?\s)\s+/g, "$1");
		text = text.replace(/\s\s+((-?)?%\})/g, " $1");

		return text;
	}
}

/**
 * Range formatting — format only selected lines
 */
export class SaltRangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {

	private fullFormatter = new SaltFormattingProvider();

	provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
		options: vscode.FormattingOptions,
	): vscode.TextEdit[] {
		// Get full edits and filter to range
		const allEdits = this.fullFormatter.provideDocumentFormattingEdits(document, options);
		return allEdits.filter((edit) =>
			range.contains(edit.range) || range.intersection(edit.range),
		);
	}
}
