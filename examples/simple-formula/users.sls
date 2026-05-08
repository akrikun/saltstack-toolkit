deploy_user:
  user.present:
    - name: deploy
    - shell: /bin/bash
    - home: /home/deploy
    - groups:
      - sudo
