FROM artifactory.hexagon.com/gl01-docker-local/clm-docker-local/linux/docker_clm_action_runner:2.2.1-70
COPY packages/k8s/dist/index.js /home/runner/k8s/index.js
