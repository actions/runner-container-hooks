<!-- ## Features -->

## Important: the Kubernetes hook is now shipped as two variants

The Kubernetes hook has been split into two separately published archives. Pick the one that matches your cluster's storage:

- **`actions-runner-hooks-k8s-<HOOK_VERSION>.zip`** — mounts the runner's workspace volume into each job pod. Requires a shared volume. Defaults to a `ReadWriteMany` claim with the Kubernetes scheduler; set `ACTIONS_RUNNER_HOOK_RWO=true` to pin job pods to the runner's node when using `ReadWriteOnce` storage. This is the faster option and is recommended when shared storage is available.
- **`actions-runner-hooks-k8s-novolume-<HOOK_VERSION>.zip`** — copies the workspace into and out of each job pod over the Kubernetes `exec` API instead of mounting a volume. Use this when shared storage is not available in your cluster. It needs no PVC, at the cost of copy time on every step.

**Upgrading:** `actions-runner-hooks-k8s-<HOOK_VERSION>.zip` now mounts a volume again. If you are currently running the volume-less behavior and want to keep it, switch `ACTIONS_RUNNER_CONTAINER_HOOKS` to the new `k8s-novolume` archive. See the [k8s](packages/k8s/README.md) and [k8s-novolume](packages/k8s-novolume/README.md) READMEs for the full requirements, including the RBAC permissions each needs.

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
- actions-runner-hooks-k8s-novolume-<HOOK_VERSION>.zip <K8S_NOVOLUME_SHA>
