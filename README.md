# SaltStack Toolkit

VS Code extension for working with SaltStack: syntax highlighting, linting, formatting, snippets, navigation, and auto-completion for Salt SLS and Jinja2 files.

## Features

### Syntax Highlighting
- YAML + Jinja2 combined grammar for `.sls` files
- Salt-specific highlighting: state IDs, state modules, requisites, `salt`, `pillar`, `grains`
- Standalone Jinja2 grammar for `.jinja`, `.j2` files

### Linting (real-time diagnostics)
- Duplicate state IDs
- Unclosed Jinja blocks (`{% if %}` without `{% endif %}`)
- Tab characters (Salt/YAML requires spaces)
- Empty state blocks (state ID without module call)
- Requisite references to non-existent state IDs
- Trailing whitespace

### Formatting (`Shift+Alt+F` or auto on save)
- **Auto-format on save** -- enabled by default via `editor.formatOnSave` (extension sets itself as default formatter for SLS/Jinja)
- **Enforce `{%-` on opening tags** -- `{% if x %}` -> `{%- if x %}`, `{%set%}` -> `{%- set %}` (enabled by default, `saltstack.format.enforceDashTags`)
- **Preserves closing `-%}`** -- existing `-%}` is never removed: `{%- if x -%}` stays `{%- if x -%}`
- Jinja tag spacing normalization: `{%if x%}` -> `{%- if x %}`, `{{var}}` -> `{{ var }}`
- Comments `{# ... #}` content is left untouched
- Tabs to spaces
- Trailing whitespace removal
- Collapses multiple consecutive blank lines to one
- Ensures final newline

### Navigation
- **Outline** (`Cmd+Shift+O`) -- state IDs, modules, includes, Jinja imports/variables
- **Go-to-Definition** (`Cmd+Click`) -- Jinja imports/includes, `salt://` sources, SLS includes, requisite references, pillar includes
- **Hover** -- documentation for 55+ state modules, all requisites, Salt builtins (`salt`, `pillar`, `grains`), execution modules (`sdb.get`, `defaults.merge`, `fast_yaml.hosts`, etc.) — 85+ entries total

### Auto-completion
- State modules (`file.managed`, `service.running`, etc.)
- Module parameters
- Requisites (`require`, `watch`, `onchanges`, etc.)
- Salt execution modules inside `salt['...']` and `salt.`

### Snippets (90+)
- Salt state modules: `file.managed`, `pkg.installed`, `service.running`, `cmd.run`, `user.present`, `docker_container.running`, etc.
- Jinja constructs: `if`, `for`, `set`, `macro`, `block`, `from ... import`, etc.
- Salt/Pillar patterns: `sdb.get`, `sdb.get_or_set_hash`, `grains.filter_by`, `fast_yaml.hosts`, `saltutil.runner`
- Boilerplates: `sls-boilerplate`, `sls-full`, `map-jinja`

### Pillar Support
- Auto-detects pillar files based on `saltstack.pillarRoots` setting
- Go-to-Definition for pillar includes (`{% include "defaults/..." %}`)
- Hover shows how to access pillar keys from states
- Disables state-specific completions in pillar context

## Build

Requirements: Node.js >= 18, npm.

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package as .vsix
npx @vscode/vsce@latest package --allow-missing-repository
```

For development with auto-rebuild on changes:

```bash
npm run watch
```

## Install

```bash
code --install-extension saltstack-toolkit-<version>.vsix
```

Or in the IDE: `Ctrl+Shift+P` -> "Extensions: Install from VSIX..." -> select the `.vsix` file.

To update, build a new version and install again -- a higher version number installs without `--force`.

## Settings

Add to your `settings.json`:

```json
{
  "saltstack.stateRoots": [
    "/path/to/salt-states"
  ],
  "saltstack.pillarRoots": [
    "/path/to/pillars/pillar"
  ],
  "saltstack.lint.enabled": true,
  "saltstack.lint.duplicateStateIds": true,
  "saltstack.lint.trailingWhitespace": true,
  "saltstack.lint.tabs": true,
  "saltstack.lint.jinjaBlocks": true,
  "saltstack.format.enforceDashTags": true
}
```

`stateRoots` and `pillarRoots` accept both absolute paths and paths relative to the workspace root. These are used for Go-to-Definition resolution of `salt://`, `{% from %}`, `{% include %}`, and SLS include references.

## License

MIT
