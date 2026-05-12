# K8s Hooks

## Description
This implementation provides a way to dynamically spin up jobs to run container workflows, rather then relying on the default docker implementation. It is meant to be used when the runner itself is running in k8s, for example when using the [Actions Runner Controller](https://github.com/actions-runner-controller/actions-runner-controller)

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
```
- The `ACTIONS_RUNNER_POD_NAME` env should be set to the name of the pod
- The `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER` env should be set to true to prevent the runner from running any jobs outside of a container
- The runner pod should map a persistent volume claim into the `_work` directory
    - The `ACTIONS_RUNNER_CLAIM_NAME` env should be set to the persistent volume claim that contains the runner's working directory, otherwise it defaults to `${ACTIONS_RUNNER_POD_NAME}-work`
- By default, the hook uses the Kubernetes scheduler and sets a *preferred* `nodeAffinity` to the runner node (`kubernetes.io/hostname`) without requiring it.
- Setting `ACTIONS_RUNNER_HOOK_RWO=true` switches this to a *required* node affinity, ensuring scheduling on the same node as the runner pod (recommended for `ReadWriteOnce` volumes).

## Storage Guidance
The K8s hooks require a shared volume between the runner pod and the job pods to share the workspace and other internal directories.

### RWX (Recommended)
The preferred way to configure storage is using a `ReadWriteMany` (RWX) Persistent Volume Claim. RWX allows the Kubernetes scheduler to place job pods on any node in the cluster, maximizing resource availability and flexibility.

To migrate from RWO to RWX:
1. Provision a new `ReadWriteMany` StorageClass if one is not available.
2. Update your PVC definition to use `accessModes: [ReadWriteMany]`.
3. No additional environment variables are needed - preferred same-node affinity is the default.

### RWO Fallback (Affinity-based)
If `ReadWriteMany` storage is not available, you can use `ReadWriteOnce` (RWO) storage. In this mode, all job pods must be scheduled on the same node as the runner pod that owns the PVC.

To enable this safely:
1. Set `ACTIONS_RUNNER_HOOK_RWO=true`.
2. The hooks will add a required `nodeAffinity` to job pods, ensuring they are scheduled on the same node as the runner pod (`kubernetes.io/hostname` match).

> **Note:** We do not recommend manually setting `nodeName` in the pod template, as the hooks handle node placement automatically via affinity.
- Some actions runner env's are expected to be set. These are set automatically by the runner.
    - `RUNNER_WORKSPACE` is expected to be set to the workspace of the runner
    - `GITHUB_WORKSPACE` is expected to be set to the workspace of the job


## Limitations
- A [job containers](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) will be required for all jobs
- Building container actions from a dockerfile is not supported at this time
- Container actions will not have access to the services network or job container network
- Docker [create options](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontaineroptions) are not supported
- Container actions will have to specify the entrypoint, since the default entrypoint will be overridden to run the commands from the workflow.
- Container actions need to have the following binaries in their container image: `sh`, `env`, `tail`.
