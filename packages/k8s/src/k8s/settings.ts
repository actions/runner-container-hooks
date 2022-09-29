import * as k8s from '@kubernetes/client-node'
export const kc = new k8s.KubeConfig()

kc.loadFromDefault()

export const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
export const k8sBatchV1Api = kc.makeApiClient(k8s.BatchV1Api)
export const k8sAuthorizationV1Api = kc.makeApiClient(k8s.AuthorizationV1Api)

export const POD_VOLUME_NAME = 'work'
export function namespace(): string {
  if (process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']) {
    return process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
  }

  const context = kc.getContexts().find(ctx => ctx.namespace)
  if (!context?.namespace) {
    throw new Error(
      'Failed to determine namespace, falling back to `default`. Namespace should be set in context, or in env variable "ACTIONS_RUNNER_KUBERNETES_NAMESPACE"'
    )
  }
  return context.namespace
}

export function registryHost(): string {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_REGISTRY_HOST'
  if (process.env[name]) {
    return process.env[name]
  }
  throw new Error(`environment variable ${name} is not set`)
}

export function registryPort(): number {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_REGISTRY_PORT'
  if (process.env[name]) {
    return parseInt(process.env[name])
  }
  throw new Error(`environment variable ${name} is not set`)
}

export function registryNodePort(): number {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_REGISTRY_NODE_PORT'
  if (process.env[name]) {
    return parseInt(process.env[name])
  }
  throw new Error(`environment variable ${name} is not set`)
}
