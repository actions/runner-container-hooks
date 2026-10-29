import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { RunContainerStepArgs } from 'hooklib'
import {
  createJob,
  createSecretForEnvs,
  deleteJob,
  deletePod,
  getContainerJobPodName,
  getPodLogs,
  getPrepareJobTimeoutSeconds,
  waitForContainerToTerminate,
  waitForPodPhases
} from '../k8s'
import {
  containerVolumes,
  fixArgs,
  formatError,
  mergeContainerWithOptions,
  PodPhase,
  readExtensionFromFile
} from '../k8s/utils'
import { JOB_CONTAINER_EXTENSION_NAME, JOB_CONTAINER_NAME } from './constants'

export async function runContainerStep(
  stepContainer: RunContainerStepArgs
): Promise<number> {
  if (stepContainer.dockerfile) {
    throw new Error('Building container actions is not currently supported')
  }

  if (!stepContainer.entryPoint) {
    throw new Error('Container actions must specify an entrypoint')
  }

  let secretName: string | undefined = undefined
  try {
    const envs = JSON.parse(
      JSON.stringify(stepContainer.environmentVariables ?? {})
    )
    envs['GITHUB_ACTIONS'] = 'true'
    if (!('CI' in envs)) {
      envs.CI = 'true'
    }
    secretName = await createSecretForEnvs(envs)
  } catch (err) {
    const message = formatError(err)
    core.debug(`createSecretForEnvs failed: ${message}`)
    throw new Error(`failed to create script environment: ${message}`)
  }

  const extension = readExtensionFromFile()

  core.debug(`Created secret ${secretName} for container job envs`)
  const container = createContainerSpec(stepContainer, secretName, extension)

  let job: k8s.V1Job
  try {
    job = await createJob(container, extension)
  } catch (err) {
    const message = formatError(err)
    core.debug(`createJob failed: ${message}`)
    throw new Error(`failed to run container step: ${message}`)
  }

  if (!job.metadata?.name) {
    throw new Error(
      `Expected job ${JSON.stringify(
        job
      )} to have correctly set the metadata.name`
    )
  }
  core.debug(`Job created, waiting for pod to start: ${job.metadata?.name}`)

  let podName: string | undefined
  try {
    try {
      podName = await getContainerJobPodName(job.metadata.name)
    } catch (err) {
      const message = formatError(err)
      core.debug(`getContainerJobPodName failed: ${message}`)
      throw new Error(`failed to get container job pod name: ${message}`)
    }

    await waitForPodPhases(
      podName,
      new Set([
        PodPhase.COMPLETED,
        PodPhase.RUNNING,
        PodPhase.SUCCEEDED,
        PodPhase.FAILED
      ]),
      new Set([PodPhase.PENDING, PodPhase.UNKNOWN]),
      getPrepareJobTimeoutSeconds()
    )
    core.debug('Container step is running or complete, pulling logs')

    await getPodLogs(podName, JOB_CONTAINER_NAME)

    core.debug('Waiting for the job container to terminate')
    const terminated = await waitForContainerToTerminate(
      podName,
      JOB_CONTAINER_NAME
    )

    // Read the exit code from the job container by name. Indexing into
    // containerStatuses picked up a sidecar's exit code whenever a pod
    // template extension contributed extra containers.
    return typeof terminated.exitCode === 'number' ? terminated.exitCode : 1
  } finally {
    // Delete the owner first so it cannot replace the pod during cleanup.
    await deleteJob(job.metadata.name).catch(err => {
      core.error(
        `Failed to delete step job ${job.metadata?.name}: ${formatError(err)}`
      )
    })
    if (podName) {
      await deletePod(podName).catch(err => {
        core.error(`Failed to delete step pod ${podName}: ${formatError(err)}`)
      })
    }
  }
}

function createContainerSpec(
  container: RunContainerStepArgs,
  secretName?: string,
  extension?: k8s.V1PodTemplateSpec
): k8s.V1Container {
  const podContainer = new k8s.V1Container()
  podContainer.name = JOB_CONTAINER_NAME
  podContainer.image = container.image
  podContainer.workingDir = container.workingDirectory
  podContainer.command = container.entryPoint
    ? [container.entryPoint]
    : undefined
  podContainer.args = container.entryPointArgs?.length
    ? fixArgs(container.entryPointArgs)
    : undefined

  if (secretName) {
    podContainer.envFrom = [
      {
        secretRef: {
          name: secretName,
          optional: false
        }
      }
    ]
  }
  podContainer.volumeMounts = containerVolumes(undefined, false, true)

  if (!extension) {
    return podContainer
  }

  const from = extension.spec?.containers?.find(
    c => c.name === JOB_CONTAINER_EXTENSION_NAME
  )
  if (from) {
    mergeContainerWithOptions(podContainer, from)
  }

  return podContainer
}
