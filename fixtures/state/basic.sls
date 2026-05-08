# Lint-clean reference state file used by tests on both VS Code and JetBrains.
{%- from "common/map.jinja" import common with context %}

include:
  - common.users

nginx_pkg:
  pkg.installed:
    - name: nginx

nginx_conf:
  file.managed:
    - name: /etc/nginx/nginx.conf
    - source: salt://nginx/files/nginx.conf
    - template: jinja
    - require:
      - pkg: nginx_pkg

nginx_service:
  service.running:
    - name: nginx
    - enable: True
    - watch:
      - file: nginx_conf
