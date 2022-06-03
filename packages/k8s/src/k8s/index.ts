import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import { ContainerInfo, PodPhase, Registry } from 'hooklib'
import * as stream from 'stream'
import { v4 as uuidv4 } from 'uuid'
import {
  getJobPodName,
  getRunnerPodName,
  getVolumeClaimName,
  RunnerInstanceLabel
} from '../hooks/constants'

const kc = new k8s.KubeConfig()

kc.loadFromDefault()

const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
const k8sBatchV1Api = kc.makeApiClient(k8s.BatchV1Api)
const k8sAuthorizationV1Api = kc.makeApiClient(k8s.AuthorizationV1Api)

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
  }
]

const secretPermission = {
  group: '',
  verbs: ['get', 'list', 'create', 'delete'],
  resource: 'secrets',
  subresource: ''
}

export async function createPod(
  jobContainer?: k8s.V1Container,
  services?: k8s.V1Container[],
  registry?: Registry
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

  appPod.spec = new k8s.V1PodSpec()
  appPod.spec.containers = containers
  appPod.spec.restartPolicy = 'Never'
  appPod.spec.nodeName = await getCurrentNodeName()
  const claimName = getVolumeClaimName()
  appPod.spec.volumes = [
    {
      name: 'work',
      persistentVolumeClaim: { claimName }
    }
  ]

  if (registry) {
    if (await isSecretsAuthOK()) {
      const secret = await createDockerSecret(registry)
      if (!secret?.metadata?.name) {
        throw new Error(`created secret does not have secret.metadata.name`)
      }
      const secretReference = new k8s.V1LocalObjectReference()
      secretReference.name = secret.metadata.name
      appPod.spec.imagePullSecrets = [secretReference]
    } else {
      throw new Error(
        `Pulls from private registry is not allowed. Please contact your self hosted runner administrator. Service account needs permissions for ${secretPermission.verbs} in resource ${secretPermission.resource}`
      )
    }
  }

  const { body } = await k8sApi.createNamespacedPod(namespace(), appPod)
  return body
}

export async function createJob(
  container: k8s.V1Container
): Promise<k8s.V1Job> {
  const job = new k8s.V1Job()

  job.apiVersion = 'batch/v1'
  job.kind = 'Job'
  job.metadata = new k8s.V1ObjectMeta()
  job.metadata.name = getJobPodName()
  job.metadata.labels = { 'runner-pod': getRunnerPodName() }

  job.spec = new k8s.V1JobSpec()
  job.spec.ttlSecondsAfterFinished = 300
  job.spec.backoffLimit = 0
  job.spec.template = new k8s.V1PodTemplateSpec()

  job.spec.template.spec = new k8s.V1PodSpec()
  job.spec.template.spec.containers = [container]
  job.spec.template.spec.restartPolicy = 'Never'
  job.spec.template.spec.nodeName = await getCurrentNodeName()

  const claimName = `${runnerName()}-work`
  job.spec.template.spec.volumes = [
    {
      name: 'work',
      persistentVolumeClaim: { claimName }
    }
  ]

  const { body } = await k8sBatchV1Api.createNamespacedJob(namespace(), job)
  return body
}

export async function getContainerJobPodName(jobName: string): Promise<string> {
  const selector = `job-name=${jobName}`
  const backOffManager = new BackOffManager(60)
  while (true) {
    const podList = await k8sApi.listNamespacedPod(
      namespace(),
      undefined,
      undefined,
      undefined,
      undefined,
      selector,
      1
    )

    if (!podList.body.items?.length) {
      await backOffManager.backOff()
      continue
    }

    if (!podList.body.items[0].metadata?.name) {
      throw new Error(
        `Failed to determine the name of the pod for job ${jobName}`
      )
    }
    return podList.body.items[0].metadata.name
  }
}

export async function deletePod(podName: string): Promise<void> {
  await k8sApi.deleteNamespacedPod(podName, namespace())
}

export async function execPodStep(
  command: string[],
  podName: string,
  containerName: string,
  stdin?: stream.Readable
): Promise<void> {
  // TODO, we need to add the path from `prependPath` to the PATH variable. How can we do that? Maybe another exec before running this one?
  // Maybe something like, get the current path, if these entries aren't in it, add them, then set the current path to that?

  // TODO: how do we set working directory? There doesn't seem to be an easy way to do it. Should we cd then execute our bash script?
  const exec = new k8s.Exec(kc)
  return new Promise(async function (resolve, reject) {
    try {
      await exec.exec(
        namespace(),
        podName,
        containerName,
        command,
        process.stdout,
        process.stderr,
        stdin ?? null,
        false /* tty */,
        resp => {
          // kube.exec returns an error if exit code is not 0, but we can't actually get the exit code
          if (resp.status === 'Success') {
            resolve()
          } else {
            reject(
              JSON.stringify({ message: resp?.message, details: resp?.details })
            )
          }
        }
      )
    } catch (error) {
      reject(error)
    }
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
      throw new Error(`job ${jobName} has failed`)
    }
    await backOffManager.backOff()
  }
}

export async function createDockerSecret(
  registry: Registry
): Promise<k8s.V1Secret> {
  const authContent = {
    auths: {
      [registry.serverUrl]: {
        username: registry.username,
        password: registry.password,
        auth: Buffer.from(
          `${registry.username}:${registry.password}`,
          'base64'
        ).toString()
      }
    }
  }
  const secretName = generateSecretName()
  const secret = new k8s.V1Secret()
  secret.immutable = true
  secret.apiVersion = 'v1'
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.name = secretName
  secret.kind = 'Secret'
  secret.data = {
    '.dockerconfigjson': Buffer.from(
      JSON.stringify(authContent),
      'base64'
    ).toString()
  }

  const { body } = await k8sApi.createNamespacedSecret(namespace(), secret)
  return body
}

export async function waitForPodPhases(
  podName: string,
  awaitingPhases: Set<PodPhase>,
  backOffPhases: Set<PodPhase>,
  maxTimeSeconds = 45 * 60 // 45 min
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
    throw new Error(`Pod ${podName} is unhealthy with phase status ${phase}`)
  }
}

async function getPodPhase(podName: string): Promise<PodPhase> {
  const podPhaseLookup = new Set<string>([
    PodPhase.PENDING,
    PodPhase.RUNNING,
    PodPhase.SUCCEEDED,
    PodPhase.FAILED,
    PodPhase.UNKNOWN
  ])
  const { body } = await k8sApi.readNamespacedPod(podName, namespace())
  const pod = body

  if (!pod.status?.phase || !podPhaseLookup.has(pod.status.phase)) {
    return PodPhase.UNKNOWN
  }
  return pod.status?.phase
}

async function isJobSucceeded(jobName: string): Promise<boolean> {
  const { body } = await k8sBatchV1Api.readNamespacedJob(jobName, namespace())
  const job = body
  if (job.status?.failed) {
    throw new Error(`job ${jobName} has failed`)
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

  logStream.on('error', err => {
    process.stderr.write(JSON.stringify(err))
  })

  const r = await log.log(namespace(), podName, containerName, logStream, {
    follow: true,
    tailLines: 50,
    pretty: false,
    timestamps: false
  })
  await new Promise(resolve => r.on('close', () => resolve(null)))
}

export async function podPrune(): Promise<void> {
  const podList = await k8sApi.listNamespacedPod(
    namespace(),
    undefined,
    undefined,
    undefined,
    undefined,
    new RunnerInstanceLabel().toString()
  )
  if (!podList.body.items.length) {
    return
  }

  await Promise.all(
    podList.body.items.map(
      pod => pod.metadata?.name && deletePod(pod.metadata.name)
    )
  )
}

export async function getPodStatus(
  name: string
): Promise<k8s.V1PodStatus | undefined> {
  const { body } = await k8sApi.readNamespacedPod(name, namespace())
  return body.status
}

export async function isAuthPermissionsOK(): Promise<boolean> {
  const sar = new k8s.V1SelfSubjectAccessReview()
  const asyncs: Promise<{
    response: unknown
    body: k8s.V1SelfSubjectAccessReview
  }>[] = []
  for (const resource of requiredPermissions) {
    for (const verb of resource.verbs) {
      sar.spec = new k8s.V1SelfSubjectAccessReviewSpec()
      sar.spec.resourceAttributes = new k8s.V1ResourceAttributes()
      sar.spec.resourceAttributes.verb = verb
      sar.spec.resourceAttributes.namespace = namespace()
      sar.spec.resourceAttributes.group = resource.group
      sar.spec.resourceAttributes.resource = resource.resource
      sar.spec.resourceAttributes.subresource = resource.subresource
      asyncs.push(k8sAuthorizationV1Api.createSelfSubjectAccessReview(sar))
    }
  }
  const responses = await Promise.all(asyncs)
  return responses.every(resp => resp.body.status?.allowed)
}

export async function isSecretsAuthOK(): Promise<boolean> {
  const sar = new k8s.V1SelfSubjectAccessReview()
  const asyncs: Promise<{
    response: unknown
    body: k8s.V1SelfSubjectAccessReview
  }>[] = []
  for (const verb of secretPermission.verbs) {
    sar.spec = new k8s.V1SelfSubjectAccessReviewSpec()
    sar.spec.resourceAttributes = new k8s.V1ResourceAttributes()
    sar.spec.resourceAttributes.verb = verb
    sar.spec.resourceAttributes.namespace = namespace()
    sar.spec.resourceAttributes.group = secretPermission.group
    sar.spec.resourceAttributes.resource = secretPermission.resource
    sar.spec.resourceAttributes.subresource = secretPermission.subresource
    asyncs.push(k8sAuthorizationV1Api.createSelfSubjectAccessReview(sar))
  }
  const responses = await Promise.all(asyncs)
  return responses.every(resp => resp.body.status?.allowed)
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
        "[ $(cat /etc/*release* | grep -i -e '^ID=*alpine*' -c) != 0 ] || exit 1"
      ],
      podName,
      containerName
    )
  } catch (err) {
    isAlpine = false
  }

  return isAlpine
}

async function getCurrentNodeName(): Promise<string> {
  const resp = await k8sApi.readNamespacedPod(getRunnerPodName(), namespace())

  const nodeName = resp.body.spec?.nodeName
  if (!nodeName) {
    throw new Error('Failed to determine node name')
  }
  return nodeName
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

function generateSecretName(): string {
  return `github-secret-${uuidv4()}`
}

function runnerName(): string {
  const name = process.env.ACTIONS_RUNNER_POD_NAME
  if (!name) {
    throw new Error(
      'Failed to determine runner name. "ACTIONS_RUNNER_POD_NAME" env variables should be set.'
    )
  }
  return name
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
  // 8080:8080/tcp
  const portFormat = /(\d{1,5})(:(\d{1,5}))?(\/(tcp|udp))?/

  const ports: k8s.V1ContainerPort[] = []
  for (const portDefinition of container.portMappings) {
    const submatches = portFormat.exec(portDefinition)
    if (!submatches) {
      throw new Error(
        `Port definition "${portDefinition}" is in incorrect format`
      )
    }
    const port = new k8s.V1ContainerPort()
    port.hostPort = Number(submatches[1])
    if (submatches[3]) {
      port.containerPort = Number(submatches[3])
    }
    if (submatches[5]) {
      port.protocol = submatches[5].toUpperCase()
    } else {
      port.protocol = 'TCP'
    }
    ports.push(port)
  }
  return ports
}

export function writeEntryPointScript(
  workingDirectory: string,
  runnerTemp: string,
  entryPoint: string,
  entryPointArgs?: string[]
): string {
  const content = `#!/bin/sh -l
cd ${workingDirectory}
exec ${entryPoint} ${entryPointArgs?.length ? entryPointArgs.join(' ') : ''}
`
  const entryPointPath = `${runnerTemp}/${uuidv4()}.sh`
  fs.writeFileSync(entryPointPath, content)
  return entryPointPath
}
