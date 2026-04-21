# ADR 0135: RWX volume strategy and RWO affinity fallback

**Date:** 22 April 2026

**Status**: Accepted

## Context

The Kubernetes hook implementation for GitHub Actions runners requires access to the runner's working directory (`_work`) within the dynamically created job pods. This shared access is typically managed via Persistent Volume Claims (PVCs).

Regardless of the storage strategy, job pods are always constrained to run on the same node as the runner pod to ensure consistent access to the local environment and state. The choice of volume access mode determines operational flexibility and multi-pod access capability rather than pod placement.

Depending on the storage provider and cluster configuration, operators may choose between `ReadWriteMany` (RWX) or `ReadWriteOnce` (RWO) access modes. RWX is preferred because it allows multiple pods to access the volume simultaneously, providing greater operational flexibility for future scaling or monitoring scenarios. RWO restricts volume access to a single pod at a time, locking the volume to that pod's specific node.

## Decision

We have decided to establish `ReadWriteMany` (RWX) as the preferred storage strategy for the Kubernetes hook. While job pods remain pinned to the runner's node, RWX provides superior operational flexibility by allowing multiple pods (such as sidecars or auxiliary tools) to access the same volume without storage-imposed locking constraints.

For environments where RWX is unavailable or undesirable, we support a `ReadWriteOnce` (RWO) fallback strategy. This fallback is implemented using node affinity to ensure that job pods are scheduled onto the same node as the runner pod that holds the RWO volume.

### Operational Guidance

1. **Preferred Model (RWX):** Operators should configure the runner with a PVC supporting `ReadWriteMany`.
2. **Fallback Model (RWO):** If using `ReadWriteOnce`, operators must enable the Kubernetes scheduler integration by setting `ACTIONS_RUNNER_USE_KUBE_SCHEDULER=true`.
3. **Node Selection:** When scheduler integration is enabled, the hook applies a `requiredDuringSchedulingIgnoredDuringExecution` node affinity targeting the runner's current node (`kubernetes.io/hostname`).
4. **Implementation Details:** 
   - The hook determines the node name via `getCurrentNodeName()` and applies affinity in `packages/k8s/src/k8s/index.ts` (lines 101, 165).
   - The scheduler behavior is toggled by the `ACTIONS_RUNNER_USE_KUBE_SCHEDULER` environment variable, as defined in `packages/k8s/src/k8s/utils.ts` (line 16).
   - The PVC claim name defaults to `${ACTIONS_RUNNER_POD_NAME}-work` unless overridden by `ACTIONS_RUNNER_CLAIM_NAME` (`packages/k8s/src/hooks/constants.ts`, lines 27-33).

### Non-Recommendations

We explicitly do **not** recommend the use of `spec.nodeName` for operator-driven scheduling. While the hook uses `nodeName` as a legacy fallback when `ACTIONS_RUNNER_USE_KUBE_SCHEDULER` is not set to `true` (`packages/k8s/src/k8s/index.ts`, lines 103, 167), this bypasses the Kubernetes scheduler and can lead to scheduling failures or resource imbalances. Operators should always prefer the affinity-based approach for RWO volumes.

## Alternatives

- **nodeName Bypass:** Directly setting `nodeName` bypasses the scheduler entirely. This was rejected as a recommendation because it prevents the scheduler from accounting for taints, tolerations, and resource pressure.
- **Local Volumes:** Using local volumes tied to specific nodes. This is a subset of the RWO fallback and is supported via the affinity mechanism.

## Consequences

- **Flexibility:** RWX users benefit from the ability to have multiple pods access the volume simultaneously, simplifying future operational extensions.
- **Node Coupling:** All users are coupled to the node where the runner pod is running. The hook ensures job pods are scheduled on the same node to maintain workspace integrity.
- **Configuration:** Operators must be aware of the `ACTIONS_RUNNER_USE_KUBE_SCHEDULER` toggle when moving from RWX to RWO. This toggle controls whether the hook uses `nodeName` (bypassing the scheduler) or node affinity (using the scheduler) to pin the pod to the runner's node.

## Migration Guidance

Operators migrating from an RWO setup that relied on default `nodeName` behavior to a more robust affinity-based setup should:
1. Ensure the runner pod has the `ACTIONS_RUNNER_USE_KUBE_SCHEDULER` environment variable set to `true`.
2. Verify that the runner's ServiceAccount has the necessary permissions to list pods (to determine its own node).

## Non-Goals

- This ADR does not recommend `nodeName` as a primary or secondary configuration path for operators.
- This ADR does not dictate specific storage providers (e.g., EBS vs. EFS vs. Azure Files), but rather the access mode strategy.
