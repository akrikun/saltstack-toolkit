import * as vscode from "vscode";
import { isPillarFile } from "../pillarContext";

/** Provides auto-completion for Salt state modules, requisites, and pillar patterns */
export class SaltCompletionProvider implements vscode.CompletionItemProvider {

	private static readonly STATE_MODULES: string[] = [
		// file
		"file.managed", "file.directory", "file.absent", "file.symlink",
		"file.recurse", "file.append", "file.replace", "file.copy",
		"file.serialize", "file.blockreplace", "file.comment", "file.uncomment",
		"file.rename", "file.tidied", "file.accumulated", "file.line",
		// pkg
		"pkg.installed", "pkg.latest", "pkg.removed", "pkg.purged",
		// pkgrepo
		"pkgrepo.managed", "pkgrepo.absent",
		// service
		"service.running", "service.dead", "service.enabled", "service.disabled",
		// cmd
		"cmd.run", "cmd.script", "cmd.wait",
		// user / group
		"user.present", "user.absent",
		"group.present", "group.absent",
		// cron
		"cron.present", "cron.absent",
		// git
		"git.latest", "git.present",
		// pip
		"pip.installed", "pip.removed",
		// archive
		"archive.extracted",
		// module
		"module.run",
		// docker
		"docker_container.running", "docker_container.absent", "docker_container.stopped",
		"docker_image.present", "docker_image.absent",
		"docker_network.present", "docker_volume.present",
		// mount
		"mount.mounted", "mount.unmounted",
		// test
		"test.nop", "test.succeed_without_changes", "test.fail_without_changes",
		"test.succeed_with_changes",
		// grains
		"grains.present", "grains.absent", "grains.list_present",
		// environ
		"environ.setenv",
		// ini
		"ini.options_present",
		// postgres
		"postgres_user.present", "postgres_user.absent",
		"postgres_database.present", "postgres_database.absent",
		"postgres_schema.present",
		"postgres_extension.present",
		// mysql
		"mysql_user.present", "mysql_user.absent",
		"mysql_database.present", "mysql_database.absent",
		"mysql_grants.present",
		// firewall / network
		"iptables.append", "iptables.insert", "iptables.delete",
		"firewalld.present",
		// ssh
		"ssh_known_hosts.present", "ssh_auth.present",
		// lvm
		"lvm.pv_present", "lvm.vg_present", "lvm.lv_present",
		// virtualenv
		"virtualenv.managed",
		// nginx (if using nginx state module)
		// supervisord
		"supervisord.running", "supervisord.dead",
	];

	private static readonly REQUISITES: string[] = [
		"require", "watch", "onchanges", "onfail", "prereq", "listen", "use",
		"require_in", "watch_in", "onchanges_in", "onfail_in", "prereq_in", "listen_in",
		"require_any", "watch_any", "onchanges_any", "onfail_any",
	];

	private static readonly STATE_PARAMS: Record<string, string[]> = {
		"file.managed": [
			"name", "source", "source_hash", "template", "user", "group",
			"mode", "makedirs", "context", "defaults", "backup",
			"contents", "contents_pillar", "encoding",
		],
		"file.directory": [
			"name", "user", "group", "mode", "makedirs", "recurse", "clean",
		],
		"file.symlink": [
			"name", "target", "force", "user", "group",
		],
		"file.recurse": [
			"name", "source", "user", "group", "dir_mode", "file_mode",
			"template", "clean", "include_empty",
		],
		"pkg.installed": [
			"name", "pkgs", "version", "refresh", "fromrepo", "skip_verify",
		],
		"service.running": [
			"name", "enable", "sig", "init_delay", "reload",
		],
		"cmd.run": [
			"name", "creates", "unless", "onlyif", "cwd", "runas", "env",
			"shell", "timeout", "output_loglevel",
		],
		"user.present": [
			"name", "uid", "gid", "home", "shell", "createhome",
			"groups", "optional_groups", "password",
		],
		"cron.present": [
			"name", "user", "minute", "hour", "daymonth", "month", "dayweek",
			"comment", "identifier",
		],
		"git.latest": [
			"name", "target", "rev", "branch", "force_reset",
			"identity", "user", "depth",
		],
		"archive.extracted": [
			"name", "source", "source_hash", "user", "group",
			"if_missing", "enforce_toplevel", "options",
		],
		"docker_container.running": [
			"name", "image", "port_bindings", "volumes", "environment",
			"restart_policy", "command", "network_mode", "hostname",
		],
	};

	private static readonly SALT_EXEC_MODULES: string[] = [
		"sdb.get", "sdb.get_or_set_hash", "sdb.set",
		"defaults.merge",
		"file.file_exists", "file.directory_exists",
		"grains.filter_by", "grains.get",
		"cmd.run", "cmd.run_all",
		"pillar.get",
		"saltutil.runner",
	];

	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.CompletionItem[] {
		const line = document.lineAt(position).text;
		const linePrefix = line.substring(0, position.character);
		const inPillar = isPillarFile(document);

		// Inside salt['...'] — suggest execution modules
		if (/salt\[['"][^'"]*$/.test(linePrefix)) {
			return this.getSaltExecModuleCompletions();
		}

		// After "salt." — suggest execution modules (dot-notation)
		if (/salt\.\w*$/.test(linePrefix)) {
			return this.getSaltDotCompletions();
		}

		// In pillar files, skip state-specific completions
		if (inPillar) {
			return [];
		}

		// After "- " at requisite level — suggest requisite keywords
		if (/^\s{4,}-\s+$/.test(linePrefix)) {
			return this.getRequisiteCompletions();
		}

		// After state module prefix (e.g. "  file." or "  cmd.")
		const modulePrefixMatch = linePrefix.match(/^\s{2,}([\w_]+)\.\s*$/);
		if (modulePrefixMatch) {
			const prefix = modulePrefixMatch[1];
			return this.getModuleFunctionCompletions(prefix);
		}

		// At state module position (indented, no dash)
		if (/^\s{2,}$/.test(linePrefix)) {
			return this.getAllModuleCompletions();
		}

		// After "    - " (parameter level) — suggest params based on parent state module
		if (/^\s{4,}-\s$/.test(linePrefix)) {
			const stateModule = this.findParentStateModule(document, position.line);
			if (stateModule) {
				return this.getParamCompletions(stateModule);
			}
		}

		return [];
	}

	private getRequisiteCompletions(): vscode.CompletionItem[] {
		return SaltCompletionProvider.REQUISITES.map((req) => {
			const item = new vscode.CompletionItem(req, vscode.CompletionItemKind.Keyword);
			item.insertText = new vscode.SnippetString(`${req}:\n      - \${1:state_id}`);
			item.detail = "Salt requisite";
			return item;
		});
	}

	private getModuleFunctionCompletions(prefix: string): vscode.CompletionItem[] {
		return SaltCompletionProvider.STATE_MODULES
			.filter((m) => m.startsWith(prefix + "."))
			.map((mod) => {
				const func = mod.split(".")[1];
				const item = new vscode.CompletionItem(func, vscode.CompletionItemKind.Method);
				item.insertText = new vscode.SnippetString(`${func}:`);
				item.detail = mod;
				return item;
			});
	}

	private getAllModuleCompletions(): vscode.CompletionItem[] {
		return SaltCompletionProvider.STATE_MODULES.map((mod) => {
			const item = new vscode.CompletionItem(mod, vscode.CompletionItemKind.Function);
			item.insertText = new vscode.SnippetString(`${mod}:`);
			item.detail = "Salt state module";
			return item;
		});
	}

	private getParamCompletions(stateModule: string): vscode.CompletionItem[] {
		const params = SaltCompletionProvider.STATE_PARAMS[stateModule];
		if (!params) return [];

		return params.map((param) => {
			const item = new vscode.CompletionItem(param, vscode.CompletionItemKind.Property);
			item.insertText = new vscode.SnippetString(`${param}: \${1}`);
			item.detail = `${stateModule} parameter`;
			return item;
		});
	}

	private getSaltExecModuleCompletions(): vscode.CompletionItem[] {
		return SaltCompletionProvider.SALT_EXEC_MODULES.map((mod) => {
			const item = new vscode.CompletionItem(mod, vscode.CompletionItemKind.Function);
			item.detail = "Salt execution module";
			return item;
		});
	}

	private getSaltDotCompletions(): vscode.CompletionItem[] {
		const dotModules = [
			{ label: "fast_yaml", detail: "Custom YAML loader module" },
			{ label: "saltutil", detail: "Salt utilities (runner, sync, etc.)" },
			{ label: "defaults", detail: "Defaults handling (merge)" },
			{ label: "grains", detail: "Grains access" },
			{ label: "pillar", detail: "Pillar access" },
			{ label: "cmd", detail: "Command execution" },
			{ label: "sdb", detail: "SDB (Vault) backend access" },
		];
		return dotModules.map(({ label, detail }) => {
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Module);
			item.detail = detail;
			return item;
		});
	}

	private findParentStateModule(document: vscode.TextDocument, lineNumber: number): string | null {
		for (let i = lineNumber - 1; i >= 0; i--) {
			const match = document.lineAt(i).text.match(/^\s+([\w]+\.[\w]+):\s*$/);
			if (match) return match[1];
			// Stop if we reach a state ID (non-indented key)
			if (/^[^\s]/.test(document.lineAt(i).text) && document.lineAt(i).text.trim() !== "") {
				break;
			}
		}
		return null;
	}
}
