<!-- ## Features -->

## Bugs

- Change command to remove sudo to fix fs-init initial container [#263]
- Sort 'find' output before hashing for consistency [#267]
- feat: check if required binaries are present [#272]
- Allow non-root container [#264]
- Improve validation checks after copying [#285]
- Fix workingDir permissions issue by creating it within init container [#283]
- Fix event.json not being copied to /github/workflow in kubernetes-novolume mode [#287]
- Reduce the amount of data copied to the workflow pod [#293]
- Overwrite runner file commands [#298]

## Misc

- Dependency updates [#276] [#277] [#278] [#279] [#304]
- Group dependabot updates [#289]

## SHA-256 Checksums

The SHA-256 checksums for the packages included in this build are shown below:

- actions-runner-hooks-docker-<HOOK_VERSION>.zip <DOCKER_SHA>
- actions-runner-hooks-k8s-<HOOK_VERSION>.zip <K8S_SHA>
