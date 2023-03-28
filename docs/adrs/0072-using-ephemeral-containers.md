# ADR 0072: Using Ephemeral Containers

**Date:** 27 March 2023
**Status**: Proposed <!--Accepted|Rejected|Superceded|Deprecated-->

## Context

We are evaluating using Kubernetes [ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/) as a drop-in replacement for creating pods for [jobs that run in containers](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) and [service containers](https://docs.github.com/en/actions/using-containerized-services/about-service-containers).

The main motivator behind using ephemeral containers is to eliminate the need for [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/). Persistent Volume implementations vary depending on the provider and we want to avoid building a dependency on it in order to provide our end-users a consistent experience.

With ephemeral containers we could leverage [emptyDir volumes](https://kubernetes.io/docs/concepts/storage/volumes/#emptydir) which fits our use case better and its behaviour is consistent across providers.

However, it's important to acknowledge that ephemeral containers were not designed to handle workloads but rather provide a mechanism to inspect running containers for debugging and troubleshooting purposes.

## Evaluation

The criteria that we are using to evaluate whether ephemeral containers are fit for purpose are:

- Networking
- Storage
- Security
- Resource limits
- Logs
- Metrics
- Compatibility
- Customizability

### Networking

Ephemeral containers share the networking namespace of the pod they are attached to. This means that ephemeral containers can access the same network interfaces as the pod and can communicate with other containers in the same pod. However, ephemeral containers cannot have ports configured and as such the fields ports, livenessProbe, and readinessProbe are not available.

In this scenario we have 3 containers in a pod:

- `runner`: the main container that runs the GitHub Actions job
- `debugger`: the first ephemeral container
- `debugger2`: the second ephemeral container

By sequentially opening ports on each of these containers and connecting to them we can demonstrate that the communication flow between the runner and the debuggers is feasible.

<details>
<summary>1. Runner -> Debugger communication</summary>

![runner->debugger](./images/runner-debugger.png)
</details>

<details>
<summary>2. Debugger -> Runner communication</summary>

![debugger->runner](./images/debugger-runner.png)
</details>

<details>
<summary>3. Debugger2 -> Debugger communication</summary>

![debugger2->debugger](./images/debugger2-debugger.png)
</details>

### Storage



## Decision

_**What** is the change being proposed? **How** will it be implemented?_

## Consequences

_What becomes easier or more difficult to do because of this change?_