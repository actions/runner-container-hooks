# K8s Hooks

## Description
This implementation provides a way to dynamically spin up jobs to run container workflows, rather then relying on the default docker implementation. It is meant to be used when the runner itself is running in k8s, for example when using the [Actions Runner Controller](https://github.com/actions-runner-controller/actions-runner-controller)

## Pre-requisites 
Some things are expected to be set when using these hooks
- The runner itself should be running in a pod, with a service account with the following permissions
    - The `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true` should be set to true
- The `ACTIONS_RUNNER_POD_NAME` env should be set to the name of the pod
- The runner pod should map a persistent volume claim into the `_work` directory
    - The `ACTIONS_RUNNER_CLAIM_NAME` should be set to the persistent volume claim that contains the runner's working directory
