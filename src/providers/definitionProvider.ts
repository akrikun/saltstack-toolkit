import * as vscode from "vscode";
import * as path from "path";
import { isPillarFile, resolvePillarPath } from "../pillarContext";

/**
 * Go-to-definition for:
 *  - Jinja imports: {% from "formula/map.jinja" import ... %}
 *  - Jinja includes: {% include "template.jinja" %} (both state and pillar)
 *  - Jinja extends: {% extends "base.jinja" %}
 *  - salt:// source references: source: salt://formula/files/template.jinja
 *  - SLS includes: - .substate  or  - formula.substate
 *  - Requisite references: - state_id_name
 *  - Pillar includes: {% include "defaults/platform.sls" %}
 */
export class SaltDefinitionProvider implements vscode.DefinitionProvider {

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Definition | null> {
		const line = document.lineAt(position).text;
		const inPillar = isPillarFile(document);

		// Jinja from/import/include/extends
		const jinjaPathMatch = line.match(
			/\{%[-\s]*(?:from|import|include|extends)\s+["']([^"']+)["']/,
		);
		if (jinjaPathMatch) {
			const target = jinjaPathMatch[1];
			// In pillar files, resolve against pillar roots first
			if (inPillar) {
				const pillarLocations = await this.resolvePillarInclude(document, target);
				if (pillarLocations && pillarLocations.length > 0) return pillarLocations;
			}
			return this.resolveSlsPath(document, target);
		}

		// salt:// source reference
		const saltSourceMatch = line.match(/source:\s+salt:\/\/(.+?)$/);
		if (saltSourceMatch) {
			const target = saltSourceMatch[1].trim();
			return this.resolveSlsPath(document, target);
		}

		// SLS include entry: "  - .substate" or "  - formula.substate"
		const includeMatch = line.match(/^\s+-\s+(\.[\w./\-]+|[\w][\w./\-]*)$/);
		if (includeMatch) {
			const ref = includeMatch[1].trim();
			return this.resolveSlsInclude(document, ref);
		}

		// Requisite reference: "      - state_id_name" (deeper indentation)
		if (!inPillar) {
			const requisiteRefMatch = line.match(/^\s{6,}-\s+([\w][\w.\-/() ]*)$/);
			if (requisiteRefMatch) {
				const stateId = requisiteRefMatch[1].trim();
				return this.findStateIdInDocument(document, stateId);
			}
		}

		return null;
	}

	private async resolvePillarInclude(
		document: vscode.TextDocument,
		targetPath: string,
	): Promise<vscode.Location[] | null> {
		// Try resolving from pillarRoots
		const uris = await resolvePillarPath(targetPath);
		if (uris.length > 0) {
			return uris.map((uri) => new vscode.Location(uri, new vscode.Position(0, 0)));
		}

		// Try relative to current file directory
		const currentDir = path.dirname(document.uri.fsPath);
		const relativeUri = vscode.Uri.file(path.join(currentDir, targetPath));
		if (await this.fileExists(relativeUri)) {
			return [new vscode.Location(relativeUri, new vscode.Position(0, 0))];
		}

		return null;
	}

	private async resolveSlsPath(
		document: vscode.TextDocument,
		targetPath: string,
	): Promise<vscode.Location[] | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return null;

		const locations: vscode.Location[] = [];
		const config = vscode.workspace.getConfiguration("saltstack");

		for (const folder of workspaceFolders) {
			// Try direct path relative to workspace root
			const directUri = vscode.Uri.joinPath(folder.uri, targetPath);
			if (await this.fileExists(directUri)) {
				locations.push(new vscode.Location(directUri, new vscode.Position(0, 0)));
			}

			// Try configured state roots
			const stateRoots = config.get<string[]>("stateRoots", ["salt", "srv/salt"]);
			for (const root of stateRoots) {
				const uri = path.isAbsolute(root)
					? vscode.Uri.file(path.join(root, targetPath))
					: vscode.Uri.joinPath(folder.uri, root, targetPath);
				if (await this.fileExists(uri)) {
					locations.push(new vscode.Location(uri, new vscode.Position(0, 0)));
				}
			}

			// Try configured pillar roots
			const pillarRoots = config.get<string[]>("pillarRoots", ["pillar", "srv/pillar"]);
			for (const root of pillarRoots) {
				const uri = path.isAbsolute(root)
					? vscode.Uri.file(path.join(root, targetPath))
					: vscode.Uri.joinPath(folder.uri, root, targetPath);
				if (await this.fileExists(uri)) {
					locations.push(new vscode.Location(uri, new vscode.Position(0, 0)));
				}
			}
		}

		// Try relative to current file directory
		const currentDir = path.dirname(document.uri.fsPath);
		const relativeUri = vscode.Uri.file(path.join(currentDir, targetPath));
		if (await this.fileExists(relativeUri)) {
			locations.push(new vscode.Location(relativeUri, new vscode.Position(0, 0)));
		}

		return locations.length > 0 ? locations : null;
	}

	private async resolveSlsInclude(
		document: vscode.TextDocument,
		ref: string,
	): Promise<vscode.Location[] | null> {
		// ".substate" is relative to current formula directory
		if (ref.startsWith(".")) {
			const currentDir = path.dirname(document.uri.fsPath);
			const relative = ref.substring(1).replace(/\./g, "/");

			// Try init.sls first, then direct .sls
			const candidates = [
				path.join(currentDir, relative + ".sls"),
				path.join(currentDir, relative, "init.sls"),
			];

			for (const candidate of candidates) {
				const uri = vscode.Uri.file(candidate);
				if (await this.fileExists(uri)) {
					return [new vscode.Location(uri, new vscode.Position(0, 0))];
				}
			}
		} else {
			// Absolute reference: "formula.substate" -> "formula/substate.sls"
			const slsPath = ref.replace(/\./g, "/");
			return this.resolveSlsPath(document, slsPath + ".sls")
				|| this.resolveSlsPath(document, slsPath + "/init.sls");
		}

		return null;
	}

	private findStateIdInDocument(
		document: vscode.TextDocument,
		stateId: string,
	): vscode.Location | null {
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			if (line.text.match(new RegExp(`^${escapeRegex(stateId)}:\\s*$`))) {
				return new vscode.Location(document.uri, new vscode.Position(i, 0));
			}
		}
		return null;
	}

	private async fileExists(uri: vscode.Uri): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	}
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
