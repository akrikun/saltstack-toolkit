import * as vscode from "vscode";
import { SaltDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { SaltHoverProvider } from "./providers/hoverProvider";
import { SaltCompletionProvider } from "./providers/completionProvider";
import { SaltDefinitionProvider } from "./providers/definitionProvider";
import { SaltDiagnosticsProvider } from "./providers/diagnosticsProvider";
import { SaltFormattingProvider, SaltRangeFormattingProvider } from "./providers/formattingProvider";

const JINJA_LANG_IDS = ["jinja", "jinja-yaml", "jinja-html", "jinja-css", "jinja-json"];

function isSupportedLanguage(languageId: string): boolean {
	return languageId === "sls" || languageId.startsWith("jinja");
}

const SLS_SELECTOR: vscode.DocumentSelector = { language: "sls", scheme: "file" };
const ALL_SELECTORS: vscode.DocumentSelector = [
	{ language: "sls", scheme: "file" },
	...JINJA_LANG_IDS.map((lang) => ({ language: lang, scheme: "file" as const })),
];

export function activate(context: vscode.ExtensionContext) {
	const symbolProvider = new SaltDocumentSymbolProvider();
	const hoverProvider = new SaltHoverProvider();
	const completionProvider = new SaltCompletionProvider();
	const definitionProvider = new SaltDefinitionProvider();
	const diagnosticsProvider = new SaltDiagnosticsProvider();
	const formattingProvider = new SaltFormattingProvider();
	const rangeFormattingProvider = new SaltRangeFormattingProvider();

	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(SLS_SELECTOR, symbolProvider),
		vscode.languages.registerHoverProvider(ALL_SELECTORS, hoverProvider),
		vscode.languages.registerCompletionItemProvider(SLS_SELECTOR, completionProvider, "."),
		vscode.languages.registerDefinitionProvider(ALL_SELECTORS, definitionProvider),
		vscode.languages.registerDocumentFormattingEditProvider(SLS_SELECTOR, formattingProvider),
		...JINJA_LANG_IDS.map((lang) =>
			vscode.languages.registerDocumentFormattingEditProvider({ language: lang, scheme: "file" }, formattingProvider),
		),
		vscode.languages.registerDocumentRangeFormattingEditProvider(SLS_SELECTOR, rangeFormattingProvider),
		...JINJA_LANG_IDS.map((lang) =>
			vscode.languages.registerDocumentRangeFormattingEditProvider({ language: lang, scheme: "file" }, rangeFormattingProvider),
		),
		diagnosticsProvider,
	);

	// Lint all open SLS files on activation
	for (const doc of vscode.workspace.textDocuments) {
		diagnosticsProvider.lintDocument(doc);
	}

	// Auto-format on save — call our formatter directly to guarantee
	// no other formatter (Prettier, etc.) can interfere
	context.subscriptions.push(
		vscode.workspace.onWillSaveTextDocument((e) => {
			if (!isSupportedLanguage(e.document.languageId)) return;
			const config = vscode.workspace.getConfiguration("saltstack.format");
			if (!config.get<boolean>("formatOnSave", true)) return;

			const editorConfig = vscode.workspace.getConfiguration("editor", e.document.uri);
			const tabSize = editorConfig.get<number>("tabSize", 2);
			const insertSpaces = editorConfig.get<boolean>("insertSpaces", true);

			const edits = formattingProvider.provideDocumentFormattingEdits(
				e.document,
				{ tabSize, insertSpaces },
			);
			e.waitUntil(Promise.resolve(edits));
		}),
	);
}

export function deactivate() {}
