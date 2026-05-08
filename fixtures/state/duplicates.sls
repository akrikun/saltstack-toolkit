# Test fixture with deliberate duplicates and unknown ref — both linters
# (VS Code + JetBrains) must flag the same lines.
foo:
  cmd.run:
    - name: echo first
    - require:
      - missing_id

foo:
  cmd.run:
    - name: echo second

inline_dup: $host
inline_dup: $host
