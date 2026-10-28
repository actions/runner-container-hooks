# K8s Hooks

## Description
This implementation provides a way to dynamically spin up jobs to run container workflows, rather than relying on the default docker implementation. It is meant to be used when the runner itself is running in k8s, for example when using the [Actions Runner Controller](https://github.com/actions-runner-controller/actions-runner-controller)

## Pre-requisites 
Some things are expected to be set when using these hooks
- The runner itself should be running in a pod, with a service account with the following permissions
```
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
  name: runner-role
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "create", "delete"]
- apiGroups: [""]
  resources: ["pods/exec"]
  verbs: ["get", "create"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get", "list", "watch",]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list", "create", "delete"]
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["get", "list", "create", "delete"]
```
- The `ACTIONS_RUNNER_POD_NAME` env should be set to the name of the pod
- The `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER` env should be set to true to prevent the runner from running any jobs outside of a container
- The runner pod should map a persistent volume claim into the `_work` directory
    - The `ACTIONS_RUNNER_CLAIM_NAME` env should be set to the persistent volume claim that contains the runner's working directory, otherwise it defaults to `${ACTIONS_RUNNER_POD_NAME}-work`
- By default, the hook uses the Kubernetes scheduler and sets a *preferred* `nodeAffinity` to the runner node (`metadata.name`) without requiring it.
- Setting `ACTIONS_RUNNER_HOOK_RWO=true` switches this to a *required* node affinity, ensuring scheduling on the same node as the runner pod (recommended for `ReadWriteOnce` volumes).
- Some actions runner env's are expected to be set. These are set automatically by the runner.
    - `RUNNER_WORKSPACE` is expected to be set to the workspace of the runner
    - `GITHUB_WORKSPACE` is expected to be set to the workspace of the job
- `ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS` optionally sets the startup timeout for both job pods and container-step pods (default: 600 seconds). Container-step pod discovery and the subsequent phase wait each use this timeout.

Shell `entryPointArgs` such as `["-c", "echo hello world"]` preserve the script as one argument. Shell-quoted arguments split on spaces by the runner are also supported and decoded before creating the container.

## Storage Guidance
The K8s hooks require a shared volume between the runner pod and the job pods to share the workspace and other internal directories.

The hook copies runner externals from the `/__e` system mount's `sourceVolumePath` into `_temp/_runner_externals` under the shared work root, and mounts that directory at `/__e`. This runner-internal location avoids repository workspace collisions, including repositories named `externals`. Source symlinks are dereferenced so the copy is self-contained; the runner installation does not need to be adjacent to the workspace.

Before copying, preparation waits for previous Jobs and pods to be deleted and verifies that the runner-created `_temp` directory is not a symlink. It then copies into a fresh private staging directory under `_temp`, removes the old internal externals tree without following destination symlinks, and renames the completed copy into place before starting any new workflow pods. Staging failures leave the old tree untouched. The legacy top-level `externals` directory is left untouched because it may contain a repository checkout.

The work root must be dedicated to this runner and its hook-managed pods; unrelated workloads must not have write access. Do not force-delete workload pods and immediately reuse the work root: force deletion can remove the API object while its containers are still running. If workloads were force-deleted, ensure their containers have stopped before reusing the volume.

If shared storage is not an option for your cluster, use the [k8s-novolume hooks](../k8s-novolume/README.md) instead, which copy the workspace into the job pod rather than mounting it.

### RWX (Recommended)
The preferred way to configure storage is using a `ReadWriteMany` (RWX) Persistent Volume Claim. RWX allows the Kubernetes scheduler to place job pods on any node in the cluster, maximizing resource availability and flexibility.

To migrate from RWO to RWX:
1. Use a StorageClass backed by storage that supports `ReadWriteMany`, and create a new PVC with `accessModes: [ReadWriteMany]`. A bound PVC's `accessModes` cannot be changed in place.
2. Stop the runner and its workflow pods, then migrate any required workspace data from the old claim to the new claim.
3. Update the runner pod's volume reference for `_work` to the new claim and set `ACTIONS_RUNNER_CLAIM_NAME` to the same claim name.
4. Restart the runner. Remove `ACTIONS_RUNNER_HOOK_RWO=true` if previously set so job pods can use the default preferred, rather than required, same-node affinity.

### RWO Fallback (Affinity-based)
If `ReadWriteMany` storage is not available, you can use `ReadWriteOnce` (RWO) storage. In this mode, all job pods must be scheduled on the same node as the runner pod that owns the PVC.

To enable this safely:
1. Set `ACTIONS_RUNNER_HOOK_RWO=true`.
2. The hooks will add a required `nodeAffinity` to job pods, ensuring they are scheduled on the same node as the runner pod (`metadata.name` field match).

> **Note:** We do not recommend manually setting `nodeName` in the pod template, as the hooks handle node placement automatically via affinity.

> **Note:** The pod template extension (`ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE`) replaces `spec.affinity` when it supplies that field. In RWO mode, the hooks then enforce the runner node's `metadata.name` in every required node-selector term for both job pods and container-step Jobs, replacing any existing `metadata.name` constraints and removing `kubernetes.io/hostname` expressions. Other affinity constraints are preserved and must also be satisfied; extensions cannot relax the required runner-node placement.


## Container-step cleanup
Each container step deletes its Kubernetes Job and pod after the job container exits, including any sidecars added by a pod template extension. Cleanup also runs if the step fails. Workflow cleanup and the next job's preparation prune leftover Jobs and pods as a fallback for interrupted hooks.

The hooks remove Job controllers with orphan propagation, then explicitly delete their pods with a nonzero grace period and wait for deletion. This avoids force-deleting the API objects while containers may still be running. Deletion waits use `ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS`; preparation fails on cleanup errors or timeouts rather than copying externals while previous workloads may still be writing.

## Limitations
- A [job containers](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) will be required for all jobs
- Building container actions from a dockerfile is not supported at this time
- Container actions will not have access to the services network or job container network
- Docker [create options](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontaineroptions) are not supported
- Container actions will have to specify the entrypoint, since the default entrypoint will be overridden to run the commands from the workflow.
- Container actions need to have the following binaries in their container image: `sh`, `env`, `tail`.
