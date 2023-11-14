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
  PodPhase,
  mergeContainerWithOptions,
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
    secretName = await createSecretForEnvs(stepContainer.environmentVariables)
  }

  const extension = readExtensionFromFile()

  core.debug(`Created secret ${secretName} for container job envs`)
  const container = createContainerSpec(stepContainer, secretName, extension)

  const job = await createJob(container, extension)
  if (!job.metadata?.name) {
    throw new Error(
      `Expected job ${JSON.stringify(
        job
      )} to have correctly set the metadata.name`
    )
  }
  core.debug(`Job created, waiting for pod to start: ${job.metadata?.name}`)

  const podName = await getContainerJobPodName(job.metadata.name)
  await waitForPodPhases(
    podName,
    new Set([PodPhase.COMPLETED, PodPhase.RUNNING, PodPhase.SUCCEEDED]),
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
    ? container.entryPointArgs.map(arg => arg.replace(/^"(.*)"$/, '$1'))
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
