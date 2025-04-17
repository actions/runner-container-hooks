## Features

- k8s: Use pod affinity when KubeScheduler is enabled [#212]
- docker: support alternative network modes [#209]

## Bugs

- Expose CI=true and GITHUB_ACTIONS env variables [#215]
- k8s: add /github/home to containerAction mounts and surface createSecretForEnvs errors [#198]
- k8s: start logging from the beginning [#184]

## Misc

- Bump node in tests to node 22 since node14 is quite old [#216]
- Bump jsonpath-plus from 10.1.0 to 10.3.0 in /packages/k8s [#213]
- Bump braces from 3.0.2 to 3.0.3 in /packages/hooklib [#194]
- Bump cross-spawn from 7.0.3 to 7.0.6 in /packages/k8s [#196]
- Bump ws from 7.5.8 to 7.5.10 in /packages/k8s [#192]
- Remove dependency on deprecated release actions [#193]
- Update to the latest available actions [#191]


## SHA-256 Checksums

The SHA-256 checksums for the packages included in this build are shown below:

- actions-runner-hooks-docker-<HOOK_VERSION>.zip <DOCKER_SHA>
- actions-runner-hooks-k8s-<HOOK_VERSION>.zip <K8S_SHA>
