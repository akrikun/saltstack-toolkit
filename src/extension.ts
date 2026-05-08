import * as vscode from "vscode";
import { SaltDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { SaltHoverProvider } from "./providers/hoverProvider";
import { SaltCompletionProvider } from "./providers/completionProvider";
import { SaltDefinitionProvider } from "./providers/definitionProvider";
import { SaltDiagnosticsProvider } from "./providers/diagnosticsProvider";
import { SaltFormattingProvider, SaltRangeFormattingProvider } from "./providers/formattingProvider";
import { PillarUsageCache } from "./pillarUsageCache";

// Languages we own (declared in package.json contributes.languages):
//   - sls       (.sls files)
//   - jinja     (.jinja, .j2, .jinja2 files)
// Languages provided by external extensions (e.g. samuelcolvin.jinjahtml) that
// we hook into so users don't lose features when those plugins re-claim file
// associations. Registering providers for unknown languageIds is a no-op in
// VS Code (the provider just never fires), so this is safe.
const EXTERNAL_JINJA_LANG_IDS = ["jinja-yaml", "jinja-html"];
const JINJA_LANG_IDS = ["jinja", ...EXTERNAL_JINJA_LANG_IDS];
const ALL_LANG_IDS = ["sls", ...JINJA_LANG_IDS];

function isSupportedLanguage(languageId: string): boolean {
	return ALL_LANG_IDS.includes(languageId);
}

const SLS_SELECTOR: vscode.DocumentSelector = { language: "sls", scheme: "file" };
const ALL_SELECTORS: vscode.DocumentSelector = ALL_LANG_IDS.map(
	(lang) => ({ language: lang, scheme: "file" as const }),
);

export function activate(context: vscode.ExtensionContext) {
	const pillarCache = new PillarUsageCache();
	context.subscriptions.push({ dispose: () => pillarCache.dispose() });

	const symbolProvider = new SaltDocumentSymbolProvider();
	const hoverProvider = new SaltHoverProvider(pillarCache);
	const completionProvider = new SaltCompletionProvider();
	const definitionProvider = new SaltDefinitionProvider(pillarCache);
	const diagnosticsProvider = new SaltDiagnosticsProvider();
	const formattingProvider = new SaltFormattingProvider();
	const rangeFormattingProvider = new SaltRangeFormattingProvider();

	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(SLS_SELECTOR, symbolProvider),
		vscode.languages.registerHoverProvider(ALL_SELECTORS, hoverProvider),
		// Completion: register for both SLS and Jinja so salt[...]/salt./pillar.get/grains.get
		// suggestions work in pure Jinja templates too.
		vscode.languages.registerCompletionItemProvider(ALL_SELECTORS, completionProvider, "."),
		vscode.languages.registerDefinitionProvider(ALL_SELECTORS, definitionProvider),
		vscode.languages.registerDocumentFormattingEditProvider(ALL_SELECTORS, formattingProvider),
		vscode.languages.registerDocumentRangeFormattingEditProvider(ALL_SELECTORS, rangeFormattingProvider),
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
