import * as vscode from "vscode";
import { isPillarFile } from "../pillarContext";

/** Hover documentation for Salt state modules, Jinja builtins, and pillar-specific functions */
export class SaltHoverProvider implements vscode.HoverProvider {

	private static readonly SALT_EXEC_MODULE_DOCS: Record<string, string> = {
		// sdb
		"sdb.get": "**sdb.get** — Retrieve a value from an SDB (Salt Database) backend.\n\nUsage: `salt['sdb.get']('sdb://profile/path/to/key')`\n\nCommon backends: Vault (`sdb://vlt/...`), Consul, etcd.",
		"sdb.get_or_set_hash": "**sdb.get_or_set_hash** — Get or auto-generate a hash value in SDB.\n\nUsage: `salt['sdb.get_or_set_hash'](uri='sdb://vlt/path', length=32, chars='...')`\n\nIf the key doesn't exist, generates a random string and stores it. Useful for passwords and secrets.",
		"sdb.set": "**sdb.set** — Set a value in an SDB backend.\n\nUsage: `salt['sdb.set']('sdb://profile/path/to/key', 'value')`",
		// defaults
		"defaults.merge": "**defaults.merge** — Deep-merge two dictionaries.\n\nUsage: `salt['defaults.merge'](base_dict, override_dict)`\n\nUseful for merging pillar data with defaults in map.jinja files.",
		// file
		"file.file_exists": "**file.file_exists** — Check if a file exists on the minion.\n\nUsage: `salt['file.file_exists']('/path/to/file')` → `True`/`False`",
		"file.directory_exists": "**file.directory_exists** — Check if a directory exists on the minion.",
		// grains
		"grains.filter_by": "**grains.filter_by** — Select a value from a dict based on a grain.\n\nUsage: `salt['grains.filter_by']({grain_value: config, ...}, grain='id')`\n\nCommon grains: `id`, `os`, `oscodename`, `osmajorrelease`.",
		"grains.get": "**grains.get** — Get a grains value with default.\n\nUsage: `salt['grains.get']('key:subkey', default)`",
		// cmd
		"cmd.run": "**cmd.run** — Execute a shell command on the minion.\n\nUsage: `salt['cmd.run']('command')`",
		"cmd.run_all": "**cmd.run_all** — Execute a command and return stdout, stderr, retcode.\n\nUsage: `salt['cmd.run_all']('command')`",
		// pillar
		"pillar.get": "**pillar.get** — Get a pillar value with optional default (supports nested keys with `:`).\n\nUsage: `salt['pillar.get']('key:subkey', 'default')`",
		// saltutil
		"saltutil.runner": "**saltutil.runner** — Execute a Salt runner function from a state/pillar.\n\nUsage: `salt.saltutil.runner('runner.function', arg=val, ...)`\n\nExample: `salt.saltutil.runner('pki_s7s.ca_get_or_set', sdb_path=..., cn=..., key_size=4096)`",
		// custom modules
		"fast_yaml.hosts": "**fast_yaml.hosts** — *(Custom module)* Load host metadata from YAML.\n\nUsage: `salt.fast_yaml.hosts('common_meta')`, `salt.fast_yaml.hosts('common_meta', nodegroups=[...], attribute='ip')`\n\nReturns a dict of host entries with `ip`, `port`, etc.",
	};

	private static readonly STATE_MODULE_DOCS: Record<string, string> = {
		// file
		"file.managed": "Manage a file — download from salt:// or http://, apply template, set ownership/permissions.\n\nKey params: `name`, `source`, `template`, `user`, `group`, `mode`, `makedirs`, `context`",
		"file.directory": "Ensure a directory exists with the correct ownership and permissions.\n\nKey params: `name`, `user`, `group`, `mode`, `makedirs`, `recurse`",
		"file.absent": "Ensure a file or directory does not exist.\n\nKey params: `name`",
		"file.symlink": "Create a symbolic link.\n\nKey params: `name`, `target`, `force`",
		"file.recurse": "Recursively deploy a directory tree from salt://.\n\nKey params: `name`, `source`, `user`, `group`, `dir_mode`, `file_mode`, `template`",
		"file.append": "Append text to a file if not already present.\n\nKey params: `name`, `text`, `source`",
		"file.replace": "Replace occurrences of a pattern in a file.\n\nKey params: `name`, `pattern`, `repl`, `count`",
		"file.copy": "Copy a file or directory.\n\nKey params: `name`, `source`, `force`",
		"file.serialize": "Serialize data and write to a file (JSON, YAML, etc.).\n\nKey params: `name`, `dataset`, `formatter`",
		"file.accumulated": "Prepare data to be added to a file.managed state via a block_replace.\n\nKey params: `name`, `filename`, `text`",
		"file.blockreplace": "Ensure a block of text in a file between markers.\n\nKey params: `name`, `marker_start`, `marker_end`, `content`",
		"file.comment": "Comment out a line in a file.\n\nKey params: `name`, `regex`, `char`",
		"file.uncomment": "Uncomment a line in a file.\n\nKey params: `name`, `regex`, `char`",
		"file.rename": "Rename a file.\n\nKey params: `name`, `source`",
		"file.tidied": "Remove old files from a directory.\n\nKey params: `name`, `age`, `matches`",

		// pkg
		"pkg.installed": "Ensure a package (or list of packages) is installed.\n\nKey params: `name`, `pkgs`, `version`, `refresh`, `fromrepo`",
		"pkg.latest": "Ensure the latest version of a package is installed.\n\nKey params: `name`, `pkgs`, `refresh`",
		"pkg.removed": "Ensure a package is removed.\n\nKey params: `name`, `pkgs`",
		"pkg.purged": "Ensure a package is purged (removed with config files).\n\nKey params: `name`, `pkgs`",

		// pkgrepo
		"pkgrepo.managed": "Manage a package repository.\n\nKey params: `name`, `humanname`, `key_url`, `file`, `dist`, `comps`",
		"pkgrepo.absent": "Ensure a package repository is absent.\n\nKey params: `name`",

		// service
		"service.running": "Ensure a service is running (and optionally enabled at boot).\n\nKey params: `name`, `enable`, `sig`, `init_delay`",
		"service.dead": "Ensure a service is stopped (and optionally disabled).\n\nKey params: `name`, `enable`",
		"service.enabled": "Ensure a service is enabled at boot.\n\nKey params: `name`",
		"service.disabled": "Ensure a service is disabled at boot.\n\nKey params: `name`",

		// cmd
		"cmd.run": "Run a shell command.\n\nKey params: `name`, `creates`, `unless`, `onlyif`, `cwd`, `runas`, `env`",
		"cmd.script": "Run a script from salt:// or URL.\n\nKey params: `name`, `source`, `template`, `cwd`, `runas`",
		"cmd.wait": "Run a command only when notified by watch/onchanges.\n\nKey params: `name`, `cwd`, `runas`",

		// user/group
		"user.present": "Ensure a user exists.\n\nKey params: `name`, `uid`, `gid`, `home`, `shell`, `createhome`, `groups`",
		"user.absent": "Ensure a user is absent.\n\nKey params: `name`, `purge`, `force`",
		"group.present": "Ensure a group exists.\n\nKey params: `name`, `gid`, `system`, `members`",
		"group.absent": "Ensure a group is absent.\n\nKey params: `name`",

		// cron
		"cron.present": "Ensure a cron job exists.\n\nKey params: `name`, `user`, `minute`, `hour`, `daymonth`, `month`, `dayweek`",
		"cron.absent": "Ensure a cron job is absent.\n\nKey params: `name`, `user`",

		// git
		"git.latest": "Clone or pull the latest from a git repo.\n\nKey params: `name`, `target`, `rev`, `branch`, `force_reset`, `identity`",
		"git.present": "Ensure a bare git repo exists.\n\nKey params: `name`",

		// pip
		"pip.installed": "Ensure a pip package is installed.\n\nKey params: `name`, `pkgs`, `requirements`, `bin_env`, `upgrade`",
		"pip.removed": "Ensure a pip package is removed.\n\nKey params: `name`, `bin_env`",

		// archive
		"archive.extracted": "Extract an archive.\n\nKey params: `name`, `source`, `source_hash`, `user`, `group`, `if_missing`, `enforce_toplevel`",

		// module
		"module.run": "Run a Salt execution module function.\n\nKey params: module function name as key, e.g. `service.systemctl_reload:`",

		// docker
		"docker_container.running": "Ensure a Docker container is running.\n\nKey params: `name`, `image`, `port_bindings`, `volumes`, `environment`, `restart_policy`",
		"docker_container.absent": "Ensure a Docker container is absent.\n\nKey params: `name`, `force`",
		"docker_container.stopped": "Ensure a Docker container is stopped.\n\nKey params: `name`",
		"docker_image.present": "Ensure a Docker image is present (pulled).\n\nKey params: `name`, `tag`",
		"docker_image.absent": "Ensure a Docker image is absent.\n\nKey params: `name`",
		"docker_network.present": "Ensure a Docker network is present.\n\nKey params: `name`, `driver`",
		"docker_volume.present": "Ensure a Docker volume is present.\n\nKey params: `name`, `driver`",

		// mount
		"mount.mounted": "Ensure a filesystem is mounted.\n\nKey params: `name`, `device`, `fstype`, `opts`, `mkmnt`",
		"mount.unmounted": "Ensure a filesystem is unmounted.\n\nKey params: `name`, `device`",

		// test
		"test.nop": "No-op state. Useful as a requisite target or placeholder.",
		"test.succeed_without_changes": "State that always succeeds without making changes.",
		"test.fail_without_changes": "State that always fails.",
		"test.succeed_with_changes": "State that succeeds and reports changes.",

		// grains
		"grains.present": "Set a grains value.\n\nKey params: `name`, `value`",
		"grains.absent": "Remove a grains value.\n\nKey params: `name`",
		"grains.list_present": "Ensure a value is in a grains list.\n\nKey params: `name`, `value`",

		// environ
		"environ.setenv": "Set an environment variable.\n\nKey params: `name`, `value`, `permanent`",

		// ini
		"ini.options_present": "Manage INI file options.\n\nKey params: `name`, `sections`",
	};

	private static readonly REQUISITE_DOCS: Record<string, string> = {
		require: "**require** — This state will not run until the required state completes successfully.",
		watch: "**watch** — Like require, but also triggers a restart/reload when the watched state changes.",
		onchanges: "**onchanges** — This state runs only if the dependency state made changes.",
		onfail: "**onfail** — This state runs only if the dependency state fails.",
		prereq: "**prereq** — Runs this state before the dependency if the dependency would make changes. Used for graceful service management.",
		listen: "**listen** — Like watch, but the triggered action runs at the end of the state run instead of immediately.",
		use: "**use** — Copy arguments from another state. Does not create ordering dependency.",
		require_in: "**require_in** — Reverse require: makes the target state require this state.",
		watch_in: "**watch_in** — Reverse watch: makes the target state watch this state.",
		onchanges_in: "**onchanges_in** — Reverse onchanges.",
		onfail_in: "**onfail_in** — Reverse onfail.",
		prereq_in: "**prereq_in** — Reverse prereq.",
		listen_in: "**listen_in** — Reverse listen.",
	};

	private static readonly SALT_BUILTINS_DOCS: Record<string, string> = {
		salt: "**salt** — Dictionary of Salt execution modules. Usage: `salt['module.function'](args)`\n\nExample: `salt['cmd.run']('whoami')`, `salt['defaults.merge'](dict1, dict2)`",
		pillar: "**pillar** — Dictionary of Pillar data for this minion. Usage: `pillar.key`, `pillar['key']`, `pillar.get('key', default)`\n\nCommon pattern: `pillar.key | default('value')`",
		grains: "**grains** — Dictionary of minion Grains (system info). Common keys: `id`, `os`, `oscodename`, `osmajorrelease`, `lsb_distrib_codename`, `cpuarch`, `mem_total`, `ip4_interfaces`",
		opts: "**opts** — Dictionary of Salt minion configuration options.",
		mine: "**mine** — Access Salt Mine data (data shared between minions).",
	};

	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.Hover | null {
		const line = document.lineAt(position).text;
		const inPillar = isPillarFile(document);

		// Check for salt['module.function'] or salt.module.function patterns
		const execModuleMatch = line.match(/salt\[['"](\w+\.\w+)['"]\]/) || line.match(/salt\.(\w+\.\w+)\(/);
		if (execModuleMatch) {
			const mod = execModuleMatch[1];
			const doc = SaltHoverProvider.SALT_EXEC_MODULE_DOCS[mod];
			if (doc) {
				const wordRange = document.getWordRangeAtPosition(position, /[\w]+\.[\w]+/);
				if (wordRange) {
					return new vscode.Hover(new vscode.MarkdownString(doc), wordRange);
				}
			}
		}

		// Check for salt.module.function (dot-notation, e.g. salt.fast_yaml.hosts)
		const dotExecMatch = line.match(/salt\.([\w]+)\.([\w]+)/);
		if (dotExecMatch) {
			const mod = `${dotExecMatch[1]}.${dotExecMatch[2]}`;
			const doc = SaltHoverProvider.SALT_EXEC_MODULE_DOCS[mod];
			if (doc) {
				const wordRange = document.getWordRangeAtPosition(position, /[\w]+/);
				if (wordRange) {
					const word = document.getText(wordRange);
					if (word === dotExecMatch[1] || word === dotExecMatch[2]) {
						return new vscode.Hover(new vscode.MarkdownString(doc), wordRange);
					}
				}
			}
		}

		// Check for state module pattern: "  module.function:" (only in state files)
		if (!inPillar) {
			const moduleMatch = line.match(/^\s+([\w]+\.[\w]+):\s*$/);
			if (moduleMatch) {
				const mod = moduleMatch[1];
				const doc = SaltHoverProvider.STATE_MODULE_DOCS[mod];
				if (doc) {
					const wordRange = document.getWordRangeAtPosition(position, /[\w]+\.[\w]+/);
					return new vscode.Hover(
						new vscode.MarkdownString(`**${mod}**\n\n${doc}`),
						wordRange,
					);
				}
			}

			// Check for requisite keywords
			const requisiteMatch = line.match(/^\s+-\s+(require|watch|onchanges|onfail|prereq|listen|use|require_in|watch_in|onchanges_in|onfail_in|prereq_in|listen_in):/);
			if (requisiteMatch) {
				const req = requisiteMatch[1];
				const doc = SaltHoverProvider.REQUISITE_DOCS[req];
				if (doc) {
					const wordRange = document.getWordRangeAtPosition(position, /[\w_]+/);
					if (wordRange && req === document.getText(wordRange)) {
						return new vscode.Hover(new vscode.MarkdownString(doc), wordRange);
					}
				}
			}
		}

		// Pillar context: show indicator on top-level YAML keys
		if (inPillar) {
			const pillarKeyMatch = line.match(/^([\w][\w.\-]*):\s/);
			if (pillarKeyMatch) {
				const wordRange = document.getWordRangeAtPosition(position, /[\w][\w.\-]*/);
				if (wordRange) {
					return new vscode.Hover(
						new vscode.MarkdownString(`**Pillar key:** \`${pillarKeyMatch[1]}\`\n\nAccessed in states as \`pillar.${pillarKeyMatch[1]}\` or \`pillar['${pillarKeyMatch[1]}']\``),
						wordRange,
					);
				}
			}
		}

		// Check for Salt builtins in Jinja context
		const wordRange = document.getWordRangeAtPosition(position, /\b[\w]+\b/);
		if (wordRange) {
			const word = document.getText(wordRange);
			const builtinDoc = SaltHoverProvider.SALT_BUILTINS_DOCS[word];
			if (builtinDoc) {
				// Verify it's inside a Jinja expression
				const before = line.substring(0, wordRange.start.character);
				if (before.includes("{{") || before.includes("{%") || before.includes("salt[") || before.includes("salt.")) {
					return new vscode.Hover(new vscode.MarkdownString(builtinDoc), wordRange);
				}
			}
		}

		return null;
	}
}
