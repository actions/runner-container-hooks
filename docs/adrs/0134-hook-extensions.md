# ADR 0134: Hook extensions

**Date:** 20 February 2024

**Status**: Accepted [^1]

## Context

The current implementation of container hooks does not allow users to customize the pods created by the hook. 
While the implementation is designed to be used as is or as a starting point, building and maintaining a custom hook implementation just to specify additional fields is not a good user experience.

## Decision

We have decided to add hook extensions to the container hook implementation. 
This will allow users to customize the pods created by the hook by specifying additional fields. 
The hook extensions will be implemented in a way that is backwards-compatible with the existing hook implementation.

To allow customization, the runner executing the hook should have `ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE` environment variable pointing to a yaml file on the runner system. 
The extension specified in that file will be applied both for job pods, and container steps.

If environment variable is set, but the file can't be read, the hook will fail, signaling incorrect configuration.

If the environment variable does not exist, the hook will apply the default spec.

In case the hook is able to read the extended spec, it will first create a default configuration, and then merged modified fields in the following way:

1. The `.metadata` fields that will be appended if they are not reserved are `labels` and `annotations`.
2. The pod spec fields except for `containers` and `volumes` are applied from the template, possibly overwriting the field.
3. The volumes are applied in form of appending additional volumes to the default volumes.
4. The containers are merged based on the name assigned to them:
   1. If the name of the container *is* "$job", the `name` and the `image` fields are going to be ignored and the spec will be applied so that `env`, `volumeMounts`, `ports` are appended to the default container spec created by the hook, while the rest of the fields are going to be applied to the newly created container spec.
   2. If the name of the container *starts with* "$", and matches the name of the [container service](https://docs.github.com/en/actions/using-containerized-services/about-service-containers), the `name` and the `image` fields are going to be ignored and the spec will be applied to that service container, so that `env`, `volumeMounts`, `ports` are appended to the default container spec for service created by the hook, while the rest of the fields are going to be applied to the created container spec. 
      If there is no container service with such name defined in the workflow, such spec extension will be ignored.  
   3. If the name of the container *does not start with* "$", the entire spec of the container will be added to the pod definition.

## Consequences

The addition of hook extensions will provide a better user experience for users who need to customize the pods created by the container hook. 
However, it will require additional effort to provide the template to the runner pod, and configure it properly.

[^1]: Supersedes [ADR 0096](0096-hook-extensions.md)