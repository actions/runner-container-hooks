import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import * as stream from 'stream'
import { finished } from 'stream/promises'
import type { ContainerInfo, Registry } from 'hooklib'
import {
  getJobPodName,
  getRunnerPodName,
  getSecretName,
  getStepPodName,
  getVolumeClaimName,
  RunnerInstanceLabel
} from '../hooks/constants'
import {
  PodPhase,
  formatError,
  mergePodSpecWithOptions,
  mergeObjectMeta,
  useRwoRequiredAffinity,
  ensureRequiredNodeAffinity,
  nodeNameRequirement,
  fixArgs
} from './utils'
import { parsePositiveMsEnv, WebSocketHeartbeat } from './heartbeat'
import type { HeartbeatWebSocket } from './heartbeat'

const kc = new k8s.KubeConfig()

kc.loadFromDefault()

const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
const k8sBatchV1Api = kc.makeApiClient(k8s.BatchV1Api)
const k8sAuthorizationV1Api = kc.makeApiClient(k8s.AuthorizationV1Api)

const DEFAULT_WAIT_FOR_POD_TIME_SECONDS = 10 * 60 // 10 min

export const POD_VOLUME_NAME = 'work'

export const requiredPermissions = [
  {
    group: '',
    verbs: ['get', 'list', 'create', 'delete'],
    resource: 'pods',
    subresource: ''
  },
  {
    group: '',
    verbs: ['get', 'create'],
    resource: 'pods',
    subresource: 'exec'
  },
  {
    group: '',
    verbs: ['get', 'list', 'watch'],
    resource: 'pods',
    subresource: 'log'
  },
  {
    group: 'batch',
    verbs: ['get', 'list', 'create', 'delete'],
    resource: 'jobs',
    subresource: ''
  },
  {
    group: '',
    verbs: ['create', 'delete', 'get', 'list'],
    resource: 'secrets',
    subresource: ''
  }
]

export async function createPod(
  jobContainer?: k8s.V1Container,
  services?: k8s.V1Container[],
  registry?: Registry,
  extension?: k8s.V1PodTemplateSpec
): Promise<k8s.V1Pod> {
  const containers: k8s.V1Container[] = []
  if (jobContainer) {
    containers.push(jobContainer)
  }
  if (services?.length) {
    containers.push(...services)
  }

  const appPod = new k8s.V1Pod()

  appPod.apiVersion = 'v1'
  appPod.kind = 'Pod'

  appPod.metadata = new k8s.V1ObjectMeta()
  appPod.metadata.name = getJobPodName()

  const instanceLabel = new RunnerInstanceLabel()
  appPod.metadata.labels = {
    [instanceLabel.key]: instanceLabel.value
  }
  appPod.metadata.annotations = {}

  appPod.spec = new k8s.V1PodSpec()
  appPod.spec.containers = containers
  appPod.spec.restartPolicy = 'Never'

  const nodeName = await getCurrentNodeName()
  const requireRwoAffinity = useRwoRequiredAffinity()
  appPod.spec.affinity = await getPodAffinity(nodeName, requireRwoAffinity)
  const claimName = getVolumeClaimName()
  appPod.spec.volumes = [
    {
      name: POD_VOLUME_NAME,
      persistentVolumeClaim: { claimName }
    }
  ]

  if (registry) {
    const secret = await createDockerSecret(registry)
    if (!secret?.metadata?.name) {
      throw new Error(`created secret does not have secret.metadata.name`)
    }
    const secretReference = new k8s.V1LocalObjectReference()
    secretReference.name = secret.metadata.name
    appPod.spec.imagePullSecrets = [secretReference]
  }

  if (extension?.metadata) {
    mergeObjectMeta(appPod, extension.metadata)
  }

  if (extension?.spec) {
    mergePodSpecWithOptions(appPod.spec, extension.spec)
  }

  if (requireRwoAffinity) {
    ensureRequiredNodeAffinity(appPod.spec, nodeName)
  }

  return await k8sApi.createNamespacedPod({
    namespace: namespace(),
    body: appPod
  })
}

export async function createJob(
  container: k8s.V1Container,
  extension?: k8s.V1PodTemplateSpec
): Promise<k8s.V1Job> {
  const runnerInstanceLabel = new RunnerInstanceLabel()

  const job = new k8s.V1Job()
  job.apiVersion = 'batch/v1'
  job.kind = 'Job'
  job.metadata = new k8s.V1ObjectMeta()
  job.metadata.name = getStepPodName()
  job.metadata.labels = { [runnerInstanceLabel.key]: runnerInstanceLabel.value }
  job.metadata.annotations = {}

  job.spec = new k8s.V1JobSpec()
  job.spec.ttlSecondsAfterFinished = 300
  job.spec.backoffLimit = 0
  job.spec.template = new k8s.V1PodTemplateSpec()

  job.spec.template.spec = new k8s.V1PodSpec()
  job.spec.template.metadata = new k8s.V1ObjectMeta()
  // Label the pod template too, otherwise the step pod the Job creates
  // carries no runner label and prunePods() cannot see it.
  job.spec.template.metadata.labels = {
    [runnerInstanceLabel.key]: runnerInstanceLabel.value
  }
  job.spec.template.metadata.annotations = {}
  job.spec.template.spec.containers = [container]
  job.spec.template.spec.restartPolicy = 'Never'

  const nodeName = await getCurrentNodeName()
  const requireRwoAffinity = useRwoRequiredAffinity()
  job.spec.template.spec.affinity = await getPodAffinity(
    nodeName,
    requireRwoAffinity
  )

  const claimName = getVolumeClaimName()
  job.spec.template.spec.volumes = [
    {
      name: POD_VOLUME_NAME,
      persistentVolumeClaim: { claimName }
    }
  ]

  if (extension) {
    if (extension.metadata) {
      mergeObjectMeta(job, extension.metadata)
      mergeObjectMeta(job.spec.template, extension.metadata)
    }
    if (extension.spec) {
      mergePodSpecWithOptions(job.spec.template.spec, extension.spec)
    }
  }

  if (requireRwoAffinity) {
    ensureRequiredNodeAffinity(job.spec.template.spec, nodeName)
  }

  return await k8sBatchV1Api.createNamespacedJob({
    namespace: namespace(),
    body: job
  })
}

export async function getContainerJobPodName(jobName: string): Promise<string> {
  const selector = `job-name=${jobName}`
  const backOffManager = new BackOffManager(getPrepareJobTimeoutSeconds())
  while (true) {
    const podList = await k8sApi.listNamespacedPod({
      namespace: namespace(),
      labelSelector: selector,
      limit: 1
    })

    if (!podList.items?.length) {
      await backOffManager.backOff()
      continue
    }

    if (!podList.items[0].metadata?.name) {
      throw new Error(
        `Failed to determine the name of the pod for job ${jobName}`
      )
    }
    return podList.items[0].metadata.name
  }
}

export async function deletePod(podName: string): Promise<void> {
  const request = { name: podName, namespace: namespace() }
  try {
    await k8sApi.deleteNamespacedPod({
      ...request,
      // Zero force-deletes the API object without waiting for the kubelet.
      gracePeriodSeconds: 1
    })
  } catch (err) {
    if (!(err instanceof k8s.ApiException && err.code === 404)) {
      throw err
    }
  }
  await waitForDeletion(`pod ${podName}`, async () =>
    k8sApi.readNamespacedPod(request)
  )
}

async function waitForDeletion(
  resource: string,
  readResource: () => Promise<unknown>
): Promise<void> {
  const backOffManager = new BackOffManager(getPrepareJobTimeoutSeconds())
  while (true) {
    try {
      await readResource()
    } catch (err) {
      if (err instanceof k8s.ApiException && err.code === 404) {
        return
      }
      throw new Error(
        `Failed to wait for deletion of ${resource}: ${formatError(err)}`
      )
    }
    try {
      await backOffManager.backOff()
    } catch (err) {
      throw new Error(
        `Failed to wait for deletion of ${resource}: ${formatError(err)}`
      )
    }
  }
}

export async function execPodStep(
  command: string[],
  podName: string,
  containerName: string,
  stdin?: stream.Readable
): Promise<number> {
  const exec = new k8s.Exec(kc)
  core.debug(
    `[execPodStep] Starting: cmd="${command[0]}" (${command.length} args), pod=${podName}, container=${containerName}`
  )

  command = fixArgs(command)

  const DEFAULT_PING_PERIOD_MS = 5000
  const pingPeriodMs = parsePositiveMsEnv(
    process.env.ACTIONS_RUNNER_HEARTBEAT_PERIOD_MS,
    DEFAULT_PING_PERIOD_MS
  )
  const pongDeadlineMs = parsePositiveMsEnv(
    process.env.ACTIONS_RUNNER_HEARTBEAT_DEADLINE_MS,
    pingPeriodMs * 12 + 1000
  )
  core.debug(
    `[execPodStep] Heartbeat config: pingPeriodMs=${pingPeriodMs}, pongDeadlineMs=${pongDeadlineMs}`
  )

  const heartbeat = new WebSocketHeartbeat(pingPeriodMs, pongDeadlineMs)

  return new Promise<number>((resolve, reject) => {
    core.debug('[execPodStep] About to call exec.exec')
    let ws: HeartbeatWebSocket | null = null

    exec
      .exec(
        namespace(),
        podName,
        containerName,
        command,
        process.stdout,
        process.stderr,
        stdin ?? null,
        false /* tty */,
        async resp => {
          core.debug(
            `[execPodStep] execPodStep response: ${JSON.stringify(resp)}`
          )

          heartbeat.stop()

          // Close WebSocket and wait for it before resolving/rejecting
          const closeWebSocket = async (): Promise<void> => {
            const socket = ws
            if (
              socket &&
              (socket.readyState === 1 || socket.readyState === 0)
            ) {
              return new Promise<void>(closeResolve => {
                const closeTimeout = setTimeout(() => {
                  core.warning(
                    '[execPodStep] WebSocket close timeout, forcing cleanup'
                  )
                  closeResolve()
                }, 5000)

                socket.once('close', () => {
                  clearTimeout(closeTimeout)
                  core.debug('[execPodStep] WebSocket closed cleanly')
                  closeResolve()
                })
                socket.close()
              })
            }
          }

          if (resp.status === 'Success') {
            core.debug(`[execPodStep] Success, code: ${resp.code}`)
            await closeWebSocket()
            resolve(resp.code || 0)
          } else {
            core.debug(
              `[execPodStep] Failure: ${JSON.stringify({ message: resp?.message, details: resp?.details })}`
            )
            await closeWebSocket()
            reject(new Error(resp?.message || 'execPodStep failed'))
          }
        }
      )
      .then(websocket => {
        core.debug('[execPodStep] exec.exec resolved, ws object received')
        ws = websocket
        if (ws) {
          heartbeat.start(ws, reject)
        } else {
          core.warning('[Heartbeat] WebSocket is null, heartbeat not started')
        }
      })
      .catch(async e => {
        heartbeat.stop()
        core.error(`[execPodStep] exec.exec threw error: ${e}`)

        // Close WebSocket before rejecting with timeout protection
        const socket = ws
        if (socket && (socket.readyState === 1 || socket.readyState === 0)) {
          await new Promise<void>(closeResolve => {
            const closeTimeout = setTimeout(() => {
              core.warning(
                '[execPodStep] WebSocket close timeout in error handler'
              )
              closeResolve()
            }, 5000)

            socket.once('close', () => {
              clearTimeout(closeTimeout)
              closeResolve()
            })
            socket.close()
          })
        }

        reject(e)
      })
  })
}

export async function waitForJobToComplete(jobName: string): Promise<void> {
  const backOffManager = new BackOffManager()
  while (true) {
    try {
      if (await isJobSucceeded(jobName)) {
        return
      }
    } catch (error) {
      throw new Error(`job ${jobName} has failed: ${formatError(error)}`)
    }
    await backOffManager.backOff()
  }
}

// Waits for a single container in the pod to terminate, rather than for the
// whole Job to complete. A Job only reports success once *every* container
// has exited, so waiting on the Job hangs forever when a pod template
// extension contributes a sidecar that is meant to run for the lifetime of
// the step. The step's result is defined by the job container alone.
export async function waitForContainerToTerminate(
  podName: string,
  containerName: string
): Promise<k8s.V1ContainerStateTerminated> {
  const backOffManager = new BackOffManager()
  while (true) {
    let status: k8s.V1PodStatus | undefined
    try {
      status = await getPodStatus(podName)
    } catch (error) {
      throw new Error(
        `failed to read status of pod ${podName}: ${formatError(error)}`
      )
    }

    const terminated = status?.containerStatuses?.find(
      c => c.name === containerName
    )?.state?.terminated
    if (terminated) {
      return terminated
    }

    if (status?.phase === PodPhase.SUCCEEDED) {
      throw new Error(
        `pod ${podName} succeeded without reporting a terminated state for container ${containerName}`
      )
    }
    if (status?.phase === PodPhase.FAILED) {
      throw new Error(
        `pod ${podName} failed: ${status.reason || 'no reason provided'}`
      )
    }

    await backOffManager.backOff()
  }
}

export async function createDockerSecret(
  registry: Registry
): Promise<k8s.V1Secret> {
  const authContent = {
    auths: {
      [registry.serverUrl || 'https://index.docker.io/v1/']: {
        username: registry.username,
        password: registry.password,
        auth: Buffer.from(`${registry.username}:${registry.password}`).toString(
          'base64'
        )
      }
    }
  }

  const runnerInstanceLabel = new RunnerInstanceLabel()

  const secretName = getSecretName()
  const secret = new k8s.V1Secret()
  secret.immutable = true
  secret.apiVersion = 'v1'
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.name = secretName
  secret.metadata.namespace = namespace()
  secret.metadata.labels = {
    [runnerInstanceLabel.key]: runnerInstanceLabel.value
  }
  secret.type = 'kubernetes.io/dockerconfigjson'
  secret.kind = 'Secret'
  secret.data = {
    '.dockerconfigjson': Buffer.from(JSON.stringify(authContent)).toString(
      'base64'
    )
  }

  return await k8sApi.createNamespacedSecret({
    namespace: namespace(),
    body: secret
  })
}

export async function createSecretForEnvs(envs: {
  [key: string]: string
}): Promise<string> {
  const runnerInstanceLabel = new RunnerInstanceLabel()

  const secret = new k8s.V1Secret()
  const secretName = getSecretName()
  secret.immutable = true
  secret.apiVersion = 'v1'
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.name = secretName

  secret.metadata.labels = {
    [runnerInstanceLabel.key]: runnerInstanceLabel.value
  }
  secret.kind = 'Secret'
  secret.data = {}
  for (const [key, value] of Object.entries(envs)) {
    secret.data[key] = Buffer.from(value).toString('base64')
  }

  await k8sApi.createNamespacedSecret({
    namespace: namespace(),
    body: secret
  })
  return secretName
}

export async function deleteSecret(secretName: string): Promise<void> {
  await k8sApi.deleteNamespacedSecret({
    name: secretName,
    namespace: namespace()
  })
}

export async function pruneSecrets(): Promise<void> {
  const secretList = await k8sApi.listNamespacedSecret({
    namespace: namespace(),
    labelSelector: new RunnerInstanceLabel().toString()
  })
  if (!secretList.items.length) {
    return
  }

  await Promise.all(
    secretList.items.map(
      async secret =>
        secret.metadata?.name && deleteSecret(secret.metadata.name)
    )
  )
}

export async function waitForPodPhases(
  podName: string,
  awaitingPhases: Set<PodPhase>,
  backOffPhases: Set<PodPhase>,
  maxTimeSeconds = DEFAULT_WAIT_FOR_POD_TIME_SECONDS
): Promise<void> {
  const backOffManager = new BackOffManager(maxTimeSeconds)
  let phase: PodPhase = PodPhase.UNKNOWN
  try {
    while (true) {
      phase = await getPodPhase(podName)
      if (awaitingPhases.has(phase)) {
        return
      }

      if (!backOffPhases.has(phase)) {
        throw new Error(
          `Pod ${podName} is unhealthy with phase status ${phase}`
        )
      }
      await backOffManager.backOff()
    }
  } catch (error) {
    throw new Error(
      `Pod ${podName} is unhealthy with phase status ${phase}: ${formatError(error)}`
    )
  }
}

export function getPrepareJobTimeoutSeconds(): number {
  const envTimeoutSeconds =
    process.env['ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS']

  if (!envTimeoutSeconds) {
    return DEFAULT_WAIT_FOR_POD_TIME_SECONDS
  }

  const timeoutSeconds = parseInt(envTimeoutSeconds, 10)
  if (!timeoutSeconds || timeoutSeconds <= 0) {
    core.warning(
      `Prepare job timeout is invalid ("${timeoutSeconds}"): use an int > 0`
    )
    return DEFAULT_WAIT_FOR_POD_TIME_SECONDS
  }

  return timeoutSeconds
}

async function getPodPhase(name: string): Promise<PodPhase> {
  const podPhaseLookup = new Set<string>([
    PodPhase.PENDING,
    PodPhase.RUNNING,
    PodPhase.SUCCEEDED,
    PodPhase.FAILED,
    PodPhase.UNKNOWN
  ])
  const pod = await k8sApi.readNamespacedPod({
    name,
    namespace: namespace()
  })

  if (!pod.status?.phase || !podPhaseLookup.has(pod.status.phase)) {
    return PodPhase.UNKNOWN
  }
  return pod.status?.phase as PodPhase
}

async function isJobSucceeded(name: string): Promise<boolean> {
  const job = await k8sBatchV1Api.readNamespacedJob({
    name,
    namespace: namespace()
  })
  if (job.status?.failed) {
    throw new Error(`job ${name} has failed`)
  }
  return !!job.status?.succeeded
}

export async function getPodLogs(
  podName: string,
  containerName: string
): Promise<void> {
  const log = new k8s.Log(kc)
  const logStream = new stream.PassThrough()
  logStream.on('data', chunk => {
    // use write rather than console.log to prevent double line feed
    process.stdout.write(chunk)
  })

  const completion = finished(logStream, { cleanup: true })
  let request: AbortController | undefined
  try {
    await Promise.all([
      completion,
      log
        .log(namespace(), podName, containerName, logStream, {
          follow: true,
          pretty: false,
          timestamps: false
        })
        .then(controller => {
          request = controller
          if (logStream.destroyed) {
            controller.abort()
          }
        })
    ])
  } finally {
    logStream.destroy()
    request?.abort()
  }
}

export async function prunePods(): Promise<void> {
  const podList = await k8sApi.listNamespacedPod({
    namespace: namespace(),
    labelSelector: new RunnerInstanceLabel().toString()
  })
  if (!podList.items.length) {
    return
  }

  await Promise.all(
    podList.items.map(async pod => {
      if (!pod.metadata?.name) {
        throw new Error('Cannot delete a pod without metadata.name')
      }
      try {
        await deletePod(pod.metadata.name)
      } catch (err) {
        throw new Error(
          `Failed to delete pod ${pod.metadata.name}: ${formatError(err)}`
        )
      }
    })
  )
}

export async function deleteJob(name: string): Promise<void> {
  const request = { name, namespace: namespace() }
  try {
    await k8sBatchV1Api.deleteNamespacedJob({
      ...request,
      // Stop the controller first, then delete its pods ourselves with a
      // nonzero grace period, even if the pod template specified zero.
      propagationPolicy: 'Orphan'
    })
  } catch (err) {
    if (!(err instanceof k8s.ApiException && err.code === 404)) {
      throw err
    }
  }
  await waitForDeletion(`job ${name}`, async () =>
    k8sBatchV1Api.readNamespacedJob(request)
  )
  const podList = await k8sApi.listNamespacedPod({
    namespace: request.namespace,
    labelSelector: `job-name=${name}`
  })
  await Promise.all(
    podList.items.map(async pod => {
      if (!pod.metadata?.name) {
        throw new Error(`Job ${name} has a pod without metadata.name`)
      }
      await deletePod(pod.metadata.name)
    })
  )
}

// Jobs are only garbage collected by ttlSecondsAfterFinished once they
// finish, so a Job whose pod never completes (a long-lived sidecar, or a
// cancelled workflow) is leaked indefinitely. Delete them explicitly.
export async function pruneJobs(): Promise<void> {
  const jobList = await k8sBatchV1Api.listNamespacedJob({
    namespace: namespace(),
    labelSelector: new RunnerInstanceLabel().toString()
  })
  if (!jobList.items.length) {
    return
  }

  await Promise.all(
    jobList.items.map(async job => {
      if (!job.metadata?.name) {
        throw new Error('Cannot delete a job without metadata.name')
      }
      try {
        await deleteJob(job.metadata.name)
      } catch (err) {
        throw new Error(
          `Failed to delete job ${job.metadata.name}: ${formatError(err)}`
        )
      }
    })
  )
}

export async function getPodStatus(
  name: string
): Promise<k8s.V1PodStatus | undefined> {
  const pod = await k8sApi.readNamespacedPod({
    name,
    namespace: namespace()
  })
  return pod.status
}

export async function isAuthPermissionsOK(): Promise<boolean> {
  const sar = new k8s.V1SelfSubjectAccessReview()
  const asyncs: Promise<k8s.V1SelfSubjectAccessReview>[] = []
  for (const resource of requiredPermissions) {
    for (const verb of resource.verbs) {
      sar.spec = new k8s.V1SelfSubjectAccessReviewSpec()
      sar.spec.resourceAttributes = new k8s.V1ResourceAttributes()
      sar.spec.resourceAttributes.verb = verb
      sar.spec.resourceAttributes.namespace = namespace()
      sar.spec.resourceAttributes.group = resource.group
      sar.spec.resourceAttributes.resource = resource.resource
      sar.spec.resourceAttributes.subresource = resource.subresource
      asyncs.push(
        k8sAuthorizationV1Api.createSelfSubjectAccessReview({ body: sar })
      )
    }
  }
  const responses = await Promise.all(asyncs)
  return responses.every(resp => resp.status?.allowed)
}

export async function isPodContainerAlpine(
  podName: string,
  containerName: string
): Promise<boolean> {
  let isAlpine = true
  try {
    await execPodStep(
      [
        'sh',
        '-c',
        '[ $(cat /etc/*release* | grep -i -e "^ID=*alpine*" -c) != 0 ] || exit 1'
      ],
      podName,
      containerName
    )
  } catch {
    isAlpine = false
  }

  return isAlpine
}

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

async function getCurrentNodeName(): Promise<string> {
  const resp = await k8sApi.readNamespacedPod({
    name: getRunnerPodName(),
    namespace: namespace()
  })

  const nodeName = resp.spec?.nodeName
  if (!nodeName) {
    throw new Error('Failed to determine node name')
  }
  return nodeName
}

async function getPodAffinity(
  nodeName: string,
  requiredDuringScheduling: boolean
): Promise<k8s.V1Affinity> {
  const affinity = new k8s.V1Affinity()
  affinity.nodeAffinity = new k8s.V1NodeAffinity()

  if (requiredDuringScheduling) {
    affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution =
      new k8s.V1NodeSelector()
    affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms =
      [
        {
          matchFields: [nodeNameRequirement(nodeName)]
        }
      ]
    return affinity
  }

  affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = [
    {
      weight: 100,
      preference: {
        matchFields: [nodeNameRequirement(nodeName)]
      }
    }
  ]

  return affinity
}

class BackOffManager {
  private backOffSeconds = 1
  totalTime = 0
  constructor(private throwAfterSeconds?: number) {
    if (!throwAfterSeconds || throwAfterSeconds < 0) {
      this.throwAfterSeconds = undefined
    }
  }

  async backOff(): Promise<void> {
    await new Promise(resolve =>
      setTimeout(resolve, this.backOffSeconds * 1000)
    )
    this.totalTime += this.backOffSeconds
    if (this.throwAfterSeconds && this.throwAfterSeconds < this.totalTime) {
      throw new Error('backoff timeout')
    }
    if (this.backOffSeconds < 20) {
      this.backOffSeconds *= 2
    }
    if (this.backOffSeconds > 20) {
      this.backOffSeconds = 20
    }
  }
}

export function containerPorts(
  container: ContainerInfo
): k8s.V1ContainerPort[] {
  const ports: k8s.V1ContainerPort[] = []
  if (!container.portMappings?.length) {
    return ports
  }
  for (const portDefinition of container.portMappings) {
    const portProtoSplit = portDefinition.split('/')
    if (portProtoSplit.length > 2) {
      throw new Error(`Unexpected port format: ${portDefinition}`)
    }

    const port = new k8s.V1ContainerPort()
    port.protocol =
      portProtoSplit.length === 2 ? portProtoSplit[1].toUpperCase() : 'TCP'

    const portSplit = portProtoSplit[0].split(':')
    if (portSplit.length > 2) {
      throw new Error('ports should have at most one ":" separator')
    }

    const parsePort = (p: string): number => {
      const num = Number(p)
      if (!Number.isInteger(num) || num < 1 || num > 65535) {
        throw new Error(`invalid container port: ${p}`)
      }
      return num
    }

    if (portSplit.length === 1) {
      port.containerPort = parsePort(portSplit[0])
    } else {
      port.hostPort = parsePort(portSplit[0])
      port.containerPort = parsePort(portSplit[1])
    }

    ports.push(port)
  }
  return ports
}

export async function getPodByName(name: string): Promise<k8s.V1Pod> {
  return await k8sApi.readNamespacedPod({
    name,
    namespace: namespace()
  })
}
