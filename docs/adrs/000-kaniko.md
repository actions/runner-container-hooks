# ADR 0000: Build container-action Dockerfiles with Kaniko

**Date**: 2022-09-29

**Status**: In Progress

# Background

[Building Dockerfiles in k8s using Kaniko](https://github.com/actions/runner-container-hooks/issues/23) has been on the radar since the beginning of container hooks.
Currently, it is only possible in ARC using a [dind/docker-in-docker](https://github.com/actions-runner-controller/actions-runner-controller/blob/master/runner/actions-runner-dind.dockerfile) sidecar container. This container needs to be launched using `--privileged`, which presents a security vulnerability.
As an alternative tool, a container running [Kaniko](https://github.com/GoogleContainerTools/kaniko) can be used to build these files instead.
Whether using dind/docker-in-docker or Kaniko, in this ADR I will refer to these containers as '**builder containers**'

# Guiding Principles
- **Security:** running a Kaniko builder container should be possible without the `--privileged` flag
- **Feature parity with Docker:** Any 'Dockerfile' that can be built with vanilla Docker should also be possible to build using a Kaniko build container
- **Function over form:** a limitation we have found with this approach is that in order for a container-action to be run as a k8s job 
(which is how it works today with container-actions that specify a registry/image instead of a local Dockerfile that we need to build),
**the k8s job needs to pull the image to be executed from a registry**. In the initial iteration, we assume a user-configured registry that is exposed as a k8s _service_ through a nodePort. Supporting the use of public registries (dockerhub, ghcr) is TBD.

## Interface
- You will set `containerMode:kubernetes` when creating a runner - this is mandatory as we're only changing the behaviour of our k8s hooks
- The user will have to provide a port to a (cluster-local) docker registry into which the Kaniko builder container can push the image
    - Currently it is provided using the `ACTIONS_RUNNER_CONTAINER_HOOKS_REGISTRY_NODE_PORT` env var
    - The hooks then build up a URI like `localhost:${registryNodePort()}/${generated-random-string-handle-image}`
    - `localhost` is the current limitation enforcing the existence of a docker registry exposed through the `nodePort` of a k8s service
- To execute a container-action, we run a k8s job by loading the image from the specified registry
- (TBD) Our hooks will then remove the image from the registry


## Limitations
- The user needs to provide a local Docker Registry (TBD on supporting ghcr or dockerhub)
- Potential incompatibilities / inconsistencies between Docker and Kaniko, none is known at this time

## Consequences
- Users can now run AND build container-actions with a local Dockerfile in their k8s cluster
