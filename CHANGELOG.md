# Changelog

## 1.6.2

### Fixes

- **Formatter no longer breaks `{% include %}` (and other content-injecting tags).** With `enforceDashTags` enabled (the default), format-on-save rewrote *every* opening tag to the dash form `{%- ... %}`. For `{% include "foo.sls" %}` where the included file starts with a top-level YAML key (e.g. `alertmanager:`), the leading dash strips the preceding newline and fuses that key onto the previous output line, corrupting the rendered pillar (`SaltRenderError: expected '<document start>', but found '<block mapping start>'`). The formatter now keeps `include` tags dashless regardless of the setting, and strips any existing leading/trailing whitespace-control dash from them. Other tags (`set`, `for`, `if`, `import*`, …) are unaffected — they produce no output, so the dash form stays safe.

## 1.6.0

### Saltcheck support
- `.tst` files are now recognized as SLS (highlighting, snippets, lint).
- 11 Saltcheck snippets: `saltcheck`, `assertEqual`, `assertNotEqual`, `assertIn`, `assertNotIn`, `assertGreater`, `assertLess`, `assertEmpty`, `assertNotEmpty`, `assertTrue`, `assertFalse`.
- Diagnostic: warns when a `.tst` test block declares no `assertion:` key (the most common Saltcheck mistake — assertion-less tests silently pass).

### Workspace index
- Project-wide index of state IDs under `stateRoots`, refreshed automatically by file-system events.
- **Cross-file go-to-definition** for requisites: Cmd+Click on `- file: foo` jumps to `foo:` no matter which file declares it.
- **Find All References** for state IDs (right-click → Find All References).
- **`SaltStack: Reindex Workspace`** command (palette).

### UX
- Status bar item showing the resolved Salt root for the active file (state vs pillar). Click to reindex.
- New commands: `SaltStack: Reindex Workspace`, `SaltStack: Format File`.
- `examples/` directory with two real lint-clean formulas.
- Shared `fixtures/` directory consumed by tests in both this repo and the JetBrains plugin repo.

### CI
- GitHub Actions workflow: `npm ci → typecheck → compile → test → vsce package` on every push and PR.

## 1.5.2

### Fixes

- **Language IDs**: `extension.ts` referenced `jinja-css`/`jinja-json` that were never declared in `package.json`. Removed; now only `sls`, `jinja`, plus opt-in interop with `jinja-yaml`/`jinja-html` (provided by `samuelcolvin.jinjahtml`).
- **Completion in Jinja files**: completion now also fires in `.jinja`/`.j2` files for `salt[...]`, `salt.`, `pillar.get`, `grains.get`, `sdb.get`, `defaults.merge`. Previously only worked in `.sls`.
- **Jinja block checker**: `{% set X = ... %}` no longer falsely required `{% endset %}`. Multi-line assignment `{% set nginx = {` is correctly skipped. Block-form with whitespace control `{%- set X -%}…{%- endset -%}` is now recognized correctly.
- **`salt://` resolver**: supports quoted forms (`"salt://..."` / `'salt://...'`), strips `?query`, `#hash`, and trailing comments. Cursor-aware so multiple `salt://` references on one line resolve correctly.
- **Requisite diagnostics**: removed hardcoded 6-space indent assumption (now uses relative indent from the requisite block header). Typed requisites (`- file: foo`, `- pkg: nginx`) are no longer flagged as false positives — they target by-name across formulas.

### Tests

- Added `node:test`-based test suite (no new runtime dependencies; `vscode` is stubbed for pure-function tests).
- 35 tests across formatter, diagnostics, salt:// extraction, and requisite detection.
- New scripts: `npm test`, `npm run typecheck`, `npm run build:test`.

## 1.5.0

### Pillar navigation overhaul

- **Nested key paths** — Cmd+Click on any pillar key (top-level or nested) now finds usages by full YAML path. Click on `data:` inside `netbox: > data:` searches for `pillar.netbox.data` (and deeper).
- **Local Jinja aliases** — detects `{% set foo = pillar.x %}` and tracks `foo.y` references as `pillar.x.y`.
- **Cross-file dict maps** — detects `{% set bar = { 'key': pillar.foo.key } %}` in one file and `{% from "X.jinja" import bar %}` in another, then resolves `bar.key` references back to `pillar.foo.key` across files.

### Pillar hover with state.apply

When hovering over a pillar key in a pillar file, the popup now shows:
- Full YAML key path
- All access forms (`pillar.x.y`, `pillar['x']['y']`, `salt['pillar.get']('x:y')`)
- **List of state formulas that consume this key**, with ready-to-run `salt '<minion>' state.apply <formula>` commands and per-formula usage counts

### Performance

- Two-level cache for pillar usage search:
  - File list cache (invalidated on file create/delete or `stateRoots` change)
  - Per-file content + analysis cache with mtime check (invalidated on file save/change)
- Subsequent searches with unchanged files skip disk reads entirely.

## 1.4.0

- Initial pillar key navigation (top-level keys only, direct `pillar.X` references).
- Pillar usage cache.

## 1.3.0

- Duplicate top-level key check now applies to pillar files too.

## 1.2.0

- Format-on-save fix: avoid triggering external formatters (Prettier, etc.) on `.sls`/`.jinja` files.
- Support for `jinja-yaml`, `jinja-html` and other `jinja-*` language IDs.

## 1.0.0

- Initial public release: syntax highlighting, linting, formatting, snippets, navigation, completion, hover.
