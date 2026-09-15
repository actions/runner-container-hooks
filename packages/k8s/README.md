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
- Some actions runner env's are expected to be set. These are set automatically by the runner.
    - `RUNNER_WORKSPACE` is expected to be set to the workspace of the runner
    - `GITHUB_WORKSPACE` is expected to be set to the workspace of the job


## Pre-seeded externals (opt-in)

On every job the `fs-init` init container moves the runner image's
`/home/runner/externals` (the bundled Node runtimes, roughly 600 MB in ~9,000
files) into the job pod's `externals` volume before the job container starts.
A platform that can provision that volume already populated — for example
from a node-local copy of the pinned runner image's externals — can skip the
move:

- Supply the `externals` volume through the hook template
  (`ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE`, `spec.volumes`, `name: externals`),
  pre-populated with the runner version's externals and a marker file
  `.externals-seeded-<runner version>` whose content is that version. The
  volume must be readable and writable by uid/gid 1001, like the emptyDir it
  replaces.
- Set `ACTIONS_RUNNER_PRESEEDED_EXTERNALS_VERSION` on the runner to that runner
  version (the runner exports no version to the hook, so it is declared beside
  the image).

`fs-init` then checks the marker inside the mounted volume and skips the move
only when it is present with the expected version as its content; a missing
or mismatched marker (a volume seeded for another runner version, or not
seeded at all) falls back to the move. Unset, the env changes nothing: the
`externals` volume is the emptyDir and the move runs as before. With the env
set but no `externals` volume in the template, the emptyDir is used and the
move runs.

## Limitations
- A [job containers](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) will be required for all jobs
- Building container actions from a dockerfile is not supported at this time
- Container actions will not have access to the services network or job container network
- Docker [create options](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontaineroptions) are not supported
- Container actions will have to specify the entrypoint, since the default entrypoint will be overridden to run the commands from the workflow.
- Container actions need to have the following binaries in their container image: `sh`, `env`, `tail`.
