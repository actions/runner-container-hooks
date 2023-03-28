# ADR 0072: Using Ephemeral Containers

**Date:** 27 March 2023

**Status**: Rejected <!--Accepted|Rejected|Superceded|Deprecated-->

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
- Customizability

### Networking

Ephemeral containers share the networking namespace of the pod they are attached to. This means that ephemeral containers can access the same network interfaces as the pod and can communicate with other containers in the same pod. However, ephemeral containers cannot have ports configured and as such the fields ports, livenessProbe, and readinessProbe are not available [^1][^2]

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

An emptyDir volume can be successfully mounted (read/write) by the runner as well as the ephemeral containers. This means that ephemeral containers can share data with the runner and other ephemeral containers.

<details>
<summary>Configuration</summary>

```yaml
# Extracted from the values.yaml for the gha-runner-scale-set helm chart
  spec:
    containers:
    - name: runner
      image: ghcr.io/actions/actions-runner:latest
      command: ["/home/runner/run.sh"]
      volumeMounts:
      - mountPath: /workspace
        name: work-volume
    volumes:
      - name: work-volume
        emptyDir:
          sizeLimit: 1Gi
```

```bash
# The API call to the Kubernetes API used to create the ephemeral containers

POD_NAME="arc-runner-set-6sfwd-runner-k7qq6"
NAMESPACE="arc-runners"

curl -v "https://<IP>:<PORT>/api/v1/namespaces/$NAMESPACE/pods/$POD_NAME/ephemeralcontainers" \
  -X PATCH \
  -H 'Content-Type: application/strategic-merge-patch+json' \
  --cacert <PATH_TO_CACERT> \
  --cert <PATH_TO_CERT> \
  --key <PATH_TO_CLIENT_KEY> \
  -d '
{
    "spec":
    {
        "ephemeralContainers":
        [
            {
                "name": "debugger",
                "command": ["sh"],
                "image": "ghcr.io/actions/actions-runner:latest",
                "targetContainerName": "runner",
                "stdin": true,
                "tty": true,
                "volumeMounts": [{
                    "mountPath": "/workspace",
                    "name": "work-volume",
                    "readOnly": false
                }]
            },
            {
                "name": "debugger2",
                "command": ["sh"],
                "image": "ghcr.io/actions/actions-runner:latest",
                "targetContainerName": "runner",
                "stdin": true,
                "tty": true,
                "volumeMounts": [{
                    "mountPath": "/workspace",
                    "name": "work-volume",
                    "readOnly": false
                }]
            }
        ]
    }
}'
```

</details>

<details>
<summary>emptyDir volume mount</summary>

![emptyDir volume mount](./images/emptyDir_volume.png)

</details>

### Security

According to the [ephemeral containers API specification](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.26/#ephemeralcontainer-v1-core) the configuration of the `securityContext` field is possible.

Ephemeral containers share the same network namespace as the pod they are attached to. This means that ephemeral containers can access the same network interfaces as the pod and can communicate with other containers in the same pod.

It is also possible for ephemeral containers to [share the process namespace](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/) with the other containers in the pod. This is disabled by default.

The above could have unpredictable security implications.

### Resource limits

Resources are not allowed for ephemeral containers. Ephemeral containers use spare resources already allocated to the pod. [^1] This is a major drawback as it means that ephemeral containers cannot be configured to have resource limits.

There are no guaranteed resources for ad-hoc troubleshooting. If troubleshooting causes a pod to exceed its resource limit it may be evicted. [^3]

### Logs

Since ephemeral containers can share volumes with the runner container, it's possible to write logs to the same volume and have them available to the runner container.

### Customizability

Ephemeral containers can run any image and tag provided, they can be customized to run any arbitrary job. However, it's important to note that the following are not feasible:

- Lifecycle is not allowed for ephemeral containers
    - Ephemeral containers will stop when their command exits, such as exiting a shell, and they will not be restarted. Unlike `kubectl exec`, processes in Ephemeral Containers will not receive an `EOF` if their connections are interrupted, so shells won't automatically exit on disconnect. There is no API support for killing or restarting an ephemeral container. The only way to exit the container is to send it an OS signal. [^4]
- Probes are not allowed for ephemeral containers.
- Ports are not allowed for ephemeral containers.

## Decision

While the evaluation shows that ephemeral containers can be used to run jobs in containers, it's important to acknowledge that ephemeral containers were not designed to handle workloads but rather provide a mechanism to inspect running containers for debugging and troubleshooting purposes.

Given the limitations of ephemeral containers, we decided not to use them outside of their intended purpose.

## Consequences

Proposal rejected, no further action required. This document will be used as a reference for future discussions.

[^1]: https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.26/#ephemeralcontainer-v1-core

[^2]: https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/

[^3]: https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/277-ephemeral-containers/README.md#notesconstraintscaveats

[^4]: https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/277-ephemeral-containers/README.md#ephemeral-container-lifecycle