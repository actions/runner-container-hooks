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

export function isLocalRegistrySet(): boolean {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_HOST'
  return !!process.env[name]
}

export function localRegistryHost(): string {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_HOST'
  if (process.env[name]) {
    return process.env[name]
  }
  throw new Error(`environment variable ${name} is not set`)
}

export function localRegistryPort(): number {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_PORT'
  if (process.env[name]) {
    return parseInt(process.env[name])
  }
  throw new Error(`environment variable ${name} is not set`)
}

export function localRegistryNodePort(): number {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_NODE_PORT'
  if (process.env[name]) {
    return parseInt(process.env[name])
  }
  throw new Error(`environment variable ${name} is not set`)
}

export function remoteRegistryHost(): string {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_REMOTE_REGISTRY_HOST'
  return process.env[name] || ''
}

export function remoteRegistryHandle(): string {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_REMOTE_REGISTRY_HANDLE'
  if (process.env[name]) {
    return process.env[name]
  }
  throw new Error(`environment variable ${name} is not set`)
}

export function remoteRegistrySecretName(): string {
  const name = 'ACTIONS_RUNNER_CONTAINER_HOOKS_REMOTE_REGISTRY_SECRET_NAME'
  if (process.env[name]) {
    return process.env[name]
  }
  throw new Error(`environment variable ${name} is not set`)
}
