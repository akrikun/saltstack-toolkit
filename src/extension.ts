import * as vscode from "vscode";
import { SaltDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { SaltHoverProvider } from "./providers/hoverProvider";
import { SaltCompletionProvider } from "./providers/completionProvider";
import { SaltDefinitionProvider } from "./providers/definitionProvider";
import { SaltDiagnosticsProvider } from "./providers/diagnosticsProvider";
import { SaltFormattingProvider, SaltRangeFormattingProvider } from "./providers/formattingProvider";

const SLS_SELECTOR: vscode.DocumentSelector = { language: "sls", scheme: "file" };
const JINJA_SELECTOR: vscode.DocumentSelector = { language: "jinja", scheme: "file" };
const ALL_SELECTORS: vscode.DocumentSelector = [
	{ language: "sls", scheme: "file" },
	{ language: "jinja", scheme: "file" },
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
		vscode.languages.registerDocumentFormattingEditProvider(JINJA_SELECTOR, formattingProvider),
		vscode.languages.registerDocumentRangeFormattingEditProvider(SLS_SELECTOR, rangeFormattingProvider),
		vscode.languages.registerDocumentRangeFormattingEditProvider(JINJA_SELECTOR, rangeFormattingProvider),
		diagnosticsProvider,
	);

	// Lint all open SLS files on activation
	for (const doc of vscode.workspace.textDocuments) {
		diagnosticsProvider.lintDocument(doc);
	}

	// Auto-format on save
	context.subscriptions.push(
		vscode.workspace.onWillSaveTextDocument((e) => {
			const config = vscode.workspace.getConfiguration("saltstack.format");
			if (!config.get<boolean>("formatOnSave", true)) return;
			if (e.document.languageId !== "sls" && e.document.languageId !== "jinja") return;

			e.waitUntil(
				vscode.commands.executeCommand("editor.action.formatDocument") as Promise<void>,
			);
		}),
	);
}

export function deactivate() {}
