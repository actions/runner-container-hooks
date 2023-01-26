# ADR 0034: Build container-action Dockerfiles with Kaniko

**Date**: 2023-01-26

**Status**: In Progress

# Background

[Building Dockerfiles in k8s using Kaniko](https://github.com/actions/runner-container-hooks/issues/23) has been on the radar since the beginning of container hooks.
Currently, this is possible in ARC using a [dind/docker-in-docker](https://github.com/actions-runner-controller/actions-runner-controller/blob/master/runner/actions-runner-dind.dockerfile) sidecar container.
This container needs to be launched using `--privileged`, which presents a security concern.

As an alternative tool, a container running [Kaniko](https://github.com/GoogleContainerTools/kaniko) can be used to build these files instead.
Kaniko doesn't need to be `--privileged`.
Whether using dind/docker-in-docker sidecar or Kaniko, in this ADR I will refer to these containers as '**builder containers**'

# Guiding Principles
- **Security:** running a Kaniko builder container should be possible without the `--privileged` flag
- **Feature parity with Docker:** Any 'Dockerfile' that can be built with vanilla Docker should also be possible to build using a Kaniko build container
- **Ease of Use:** The customer should be able to build and push Docker images with minimal configuration

## Limitations

### User provided registry
The user needs to provide a a remote registry (like ghcr.io or dockerhub) and credentials, for the Kaniko builder container to push to and k8s to pull from later. This is the user's responsiblity so that our solution remains lightweight and generic.
- Alternatively, a user-managed local Docker Registry within the k8s cluster can of course be used instead

### Kaniko feature limit
Anything Kaniko can't do we'll be by definition unable to help with. Potential incompatibilities / inconsistencies between Docker and Kaniko will naturally be inherited by our solution.

## Interface
The user will set `containerMode:kubernetes`, because this is a change to the behaviour of our k8s hooks

The user will set two ENVs:
- `ACTIONS_RUNNER_CONTAINER_HOOKS_K8S_REGISTRY_HOST`: e.g. `ghcr.io/OWNER` or `dockerhandle`.
- `ACTIONS_RUNNER_CONTAINER_HOOKS_K8S_REGISTRY_SECRET_NAME`: e.g. `docker-secret`: the name of the `k8s` secret resource that allows you to authenticate against the registry with the given handle above 

The workspace is used as the image name.

The image tag is a random generated string.

To execute a container-action, we then run a k8s job by loading the image from the specified registry

## Additional configuration

Users may want to use different URLs for the registry when pushing and pulling an image as they will be invoked by different machines on different networks.

- The **Kaniko build container pushes the image** after building is a pod that belongs to the runner pod.
- The **kubelet pulls the image** before starting a pod.

The above two might not resolve all host names 100% the same so it makes sense to allow different push and pull URLs.

ENVs `ACTIONS_RUNNER_CONTAINER_HOOKS_K8S_REGISTRY_HOST_PUSH` and `ACTIONS_RUNNER_CONTAINER_HOOKS_K8S_REGISTRY_HOST_PULL` will be preferred if set. 

### Example

As an example, a cluster local docker registry could be a long running pod exposed as a service _and_ as a NodePort.

The Kaniko builder pod would push to `my-local-registry.default.svc.cluster.local:12345/foohandle`. (`ACTIONS_RUNNER_CONTAINER_HOOKS_K8S_REGISTRY_HOST_PUSH`)
This URL cannot be resolved by the kubelet to pull the image, so we need a secondary URL to pull it - in this case, using the NodePort, this URL is localhost:NODEPORT/foohandle. (`ACTIONS_RUNNER_CONTAINER_HOOKS_K8S_REGISTRY_HOST_PULL)


## Consequences
- Users build container-actions with a local Dockerfile in their k8s cluster without a privileged docker builder container
