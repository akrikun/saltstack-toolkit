{%- from "map-jinja-formula/map.jinja" import nginx with context %}

# Try Cmd+Click on `nginx` above — it jumps to map.jinja.
# Try Cmd+Click on `pkg: nginx_pkg` below — it jumps to the state ID below.

nginx_pkg:
  pkg.installed:
    - name: {{ nginx.pkg }}

nginx_conf:
  file.managed:
    - name: {{ nginx.config_path }}
    - source: salt://map-jinja-formula/files/nginx.conf.j2
    - template: jinja
    - require:
      - pkg: nginx_pkg

nginx_service:
  service.running:
    - name: {{ nginx.service }}
    - enable: True
    - watch:
      - file: nginx_conf
