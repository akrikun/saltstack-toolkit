# Pillar fixture with nested structure — exercises pillar key path detection
# and cross-file usage search.
nginx:
  fqdns:
    - example.com
  worker_count: auto

centrifugo:
  nginx_fqdns:
    - centrifugo.example.com

# Two top-level keys with the same name — should be flagged as duplicate.
duplicate_top: foo
duplicate_top: bar
