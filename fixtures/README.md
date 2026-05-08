# Shared fixtures

These files are consumed by the unit tests of both plugins:

* `code-salt-extension`        (VS Code)
* `code-salt-extension-jetbrains`  (JetBrains)

The JetBrains repo holds a copy or symlink of this directory; CI in both repos
runs the same fixtures against the regex/heuristic helpers, so a regression on
one side breaks both pipelines.

Layout:

```
fixtures/
├── state/         clean and broken state files
├── pillar/        pillar-side fixtures
└── saltcheck/     .tst files (assertion / no-assertion)
```

Don't add IDE-specific configuration here — fixtures must be plain Salt files.
