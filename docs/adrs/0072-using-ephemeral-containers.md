# ADR 0072: Using Ephemeral Containers

**Date:** 27 March 2023
**Status**: Proposed <!--Accepted|Rejected|Superceded|Deprecated-->

## Context

We are evaluating using Kubernetes [ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/) as a drop-in replacement for creating pods for [jobs that run in containers](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) and service containers.

The main motivator behind using ephemeral containers is to eliminate the need for [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/). Persistent Volume implementations vary depending on the provider and we want to avoid building a dependency on it.

With ephemeral containers we could leverage [emptyDir volumes](https://kubernetes.io/docs/concepts/storage/volumes/#emptydir) which fits our use case better.

## Decision

_**What** is the change being proposed? **How** will it be implemented?_

## Consequences

_What becomes easier or more difficult to do because of this change?_