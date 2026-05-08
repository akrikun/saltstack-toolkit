# Minimal SaltStack formula. Open this file in VS Code with the SaltStack
# Toolkit installed to see syntax highlighting, completion (try `file.` after
# the indent), Cmd+Click on requisite refs, and on-save formatting.

include:
  - .users

ntp_pkg:
  pkg.installed:
    - name: ntp

ntp_conf:
  file.managed:
    - name: /etc/ntp.conf
    - source: salt://simple-formula/files/ntp.conf
    - require:
      - pkg: ntp_pkg

ntp_service:
  service.running:
    - name: ntp
    - enable: True
    - watch:
      - file: ntp_conf
