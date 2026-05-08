# One block has assertion, one doesn't. The linter must flag the second one.
nginx_running:
  module_and_run: service.status
  assertion: assertEqual
  expected-return:
    nginx: True

silently_passing_test:
  module_and_run: cmd.run
  args:
    - whoami
  # No assertion: — must be flagged
