# Roadmap

Goal: surpass `korekontrol/vscode-saltstack` not just on snippets but on real
IDE features. Items are ordered by impact / size; status updated as work lands.

Legend: ✅ done · 🚧 in progress · ⏳ planned · 💤 deferred (with reason)

## VS Code (`saltstack-toolkit`)

### 1. Saltcheck support
- ✅ Register `.tst` files as `sls` (so existing highlighting/snippets/lint work).
- ✅ Snippets for the common Saltcheck assertions (`assertEqual`, `assertNotEqual`,
  `assertIn`, `assertEmpty`, `assertTrue`, …).
- ✅ Tag-style diagnostics: warn when a `.tst` block has no `assertion:` key
  (catches the most common mistake — running an assertion-less test silently).
- ⏳ Tree-sitter–aware highlighting of assertion module names is not needed yet
  because the existing SLS grammar already highlights them as state modules.

### 2. Workspace index for state IDs
- ✅ Project-wide index: every top-level state ID found under `stateRoots`,
  refreshed by `FileSystemWatcher` (same cache layer as `PillarUsageCache`).
- ✅ Cross-file go-to-definition for typed requisites (`- file: foo`) and
  untyped (`- foo`).
- ✅ Cross-file find-usages for state IDs.
- ✅ `SaltStack: Reindex workspace` command (palette).

### 3. Salt-aware diagnostics
- ✅ Broken `{% include "…" %}` / `{% from "…" import … %}` (file does not exist
  in any state or pillar root).
- ✅ Broken `salt://` source (file does not exist in any state root).
- ✅ Cross-file requisite reference that doesn't exist anywhere in the workspace
  index — current per-file check already catches local; the cross-file flag
  fires only when the index is also missing it.
- ✅ Top-file (`top.sls`) sanity: includes that don't resolve.
- ⏳ Duplicate state IDs honor Jinja branches today; cross-file dedup of
  state IDs across includes is deferred (rarely useful, often noisy).

### 4. Version-aware completion
- 💤 Deferred. Requires a versioned data set (`salt 3006`, `3007`, `master`, …)
  per-module-per-parameter, plus deprecation metadata. Significant effort and
  ongoing maintenance burden. Until then we keep the curated subset matching
  current Salt LTS and document the limitation in the README.

### 5. UX polish
- ✅ Status bar item showing the resolved Salt state root for the active file.
- ✅ Command palette actions: `Reindex workspace`, `Format Salt file`,
  `Open Salt root`.
- ✅ `examples/` with two real, lint-clean formulas (a stateless formula and a
  small map.jinja-based formula).
- ⏳ README screenshots/gifs are placeholders; will fill in once features land.

### 6. CI
- ✅ GitHub Actions: `npm ci → typecheck → compile → test → vsce package` on
  every push and PR.
- ⏳ Marketplace publishing is manual (intentional — needs a human-reviewed
  changelog/version bump).

---

## JetBrains (`saltstack-toolkit-jetbrains`)

### 1. Plugin Verifier in CI
- ✅ Gradle's `runPluginVerifier` task wired into a GitHub Actions matrix
  job covering IDEA-IC, PyCharm-PC, WebStorm and GoLand for the
  `since-build`/`until-build` range.

### 2. Tests
- ✅ JUnit 5 unit tests already cover formatter, set-form detection,
  salt:// extraction and requisite checks (43 tests).
- 🚧 Light integration tests for the `SaltLexer`/parser definition and the
  `SaltCompletionContributor` are scaffolded but disabled in CI by default
  because the IntelliJ test framework doubles total test time.

### 3. Shared fixtures
- ✅ Top-level `fixtures/` directory in the JetBrains repo, mirrored into the
  VS Code repo. Both test suites consume the same `.sls`/`.tst` corpora —
  if a regex/parser regresses on either side, both CIs fail.

### 4. Safe formatter
- ✅ Default for `enforceDashTags` flipped to `false`. The dash-vs-no-dash
  choice changes Jinja runtime whitespace, so we no longer make that change
  on save by default. Users who want it on can opt in.

### 5. Marketplace-ready
- ✅ Long-form description in `plugin.xml` with feature list, screenshots
  placeholder URLs, and link to the GitHub repo.
- ✅ Per-version `<change-notes>` consumed by JetBrains Marketplace.
- ⏳ Real screenshots once features stabilize.

### 6. Compatibility matrix
- ✅ Plugin Verifier covers IDEA-IC and PyCharm-PC at since-build through
  current. Other JetBrains IDEs (`WS`, `GO`, `PS`, `RM`) are
  IntelliJ-Platform-based and run the same plugin. Listed in README.

---

## Cross-cutting

### Shared core logic
Where reasonable the two plugins implement the same regexes/heuristics:
- pillar key path detection (`getPillarKeyPath`)
- alias / dict-map / import resolution (`PillarUsageCache`)
- assignment-vs-block `{% set %}` (`isAssignmentSet`)
- requisite ref validation (`findUnknownRequisiteRefs`)
- salt:// extraction (`extractSaltUri`)

These are intentionally written without IDE deps (pure functions in TS / Kotlin
companion objects) so the test suites on both sides assert the same behavior
against the same fixtures.

### Definition of done
A roadmap item is "done" when:
- behavior is covered by automated tests on the relevant side,
- fixtures live in `fixtures/`,
- CI green,
- `npm ci && npm test` (VS Code) or `gradle test` (JB) reproduce locally,
- README only describes shipped features, not aspirational ones.
