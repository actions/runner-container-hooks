import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { RunContainerStepArgs } from 'hooklib'
import {
  createJob,
  createSecretForEnvs,
  getContainerJobPodName,
  getPodLogs,
  getPodStatus,
  waitForJobToComplete,
  waitForPodPhases
} from '../k8s'
import {
  containerVolumes,
  fixArgs,
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

  let secretName: string | undefined = undefined
  if (stepContainer.environmentVariables) {
    try {
      const envs = JSON.parse(
        JSON.stringify(stepContainer.environmentVariables)
      )
      envs['GITHUB_ACTIONS'] = 'true'
      if (!('CI' in envs)) {
        envs.CI = 'true'
      }
      secretName = await createSecretForEnvs(envs)
    } catch (err) {
      core.debug(`createSecretForEnvs failed: ${JSON.stringify(err)}`)
      const message = (err as any)?.response?.body?.message || err
      throw new Error(`failed to create script environment: ${message}`)
    }
  }

  const extension = readExtensionFromFile()

  core.debug(`Created secret ${secretName} for container job envs`)
  const container = createContainerSpec(stepContainer, secretName, extension)

  let job: k8s.V1Job
  try {
    job = await createJob(container, extension)
  } catch (err) {
    core.debug(`createJob failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step: ${message}`)
  }

  if (!job.metadata?.name) {
    throw new Error(
      `Expected job ${JSON.stringify(
        job
      )} to have correctly set the metadata.name`
    )
  }
  core.debug(`Job created, waiting for pod to start: ${job.metadata?.name}`)

  let podName: string
  try {
    podName = await getContainerJobPodName(job.metadata.name)
  } catch (err) {
    core.debug(`getContainerJobPodName failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
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
    new Set([PodPhase.PENDING, PodPhase.UNKNOWN])
  )
  core.debug('Container step is running or complete, pulling logs')

  await getPodLogs(podName, JOB_CONTAINER_NAME)

  core.debug('Waiting for container job to complete')
  await waitForJobToComplete(job.metadata.name)

  // pod has failed so pull the status code from the container
  const status = await getPodStatus(podName)
  if (status?.phase === 'Succeeded') {
    return 0
  }
  if (!status?.containerStatuses?.length) {
    core.error(
      `Can't determine container status from response:  ${JSON.stringify(
        status
      )}`
    )
    return 1
  }
  const exitCode =
    status.containerStatuses[status.containerStatuses.length - 1].state
      ?.terminated?.exitCode
  return Number(exitCode) || 1
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
