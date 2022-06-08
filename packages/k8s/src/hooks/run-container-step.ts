import * as k8s from '@kubernetes/client-node'
import * as core from '@actions/core'
import { PodPhase } from 'hooklib'
import {
  createJob,
  createSecretForEnvs,
  getContainerJobPodName,
  getPodLogs,
  getPodStatus,
  waitForJobToComplete,
  waitForPodPhases
} from '../k8s'
import { JOB_CONTAINER_NAME } from './constants'
import { containerVolumes } from '../k8s/utils'

export async function runContainerStep(stepContainer): Promise<number> {
  if (stepContainer.dockerfile) {
    throw new Error('Building container actions is not currently supported')
  }
  let secretName: string | undefined = undefined
  if (stepContainer['environmentVariables']) {
    secretName = await createSecretForEnvs(
      stepContainer['environmentVariables']
    )
  }
  const container = createPodSpec(stepContainer, secretName)
  const job = await createJob(container)
  if (!job.metadata?.name) {
    throw new Error(
      `Expected job ${JSON.stringify(
        job
      )} to have correctly set the metadata.name`
    )
  }
  const podName = await getContainerJobPodName(job.metadata.name)
  await waitForPodPhases(
    podName,
    new Set([PodPhase.COMPLETED, PodPhase.RUNNING, PodPhase.SUCCEEDED]),
    new Set([PodPhase.PENDING, PodPhase.UNKNOWN])
  )
  await getPodLogs(podName, JOB_CONTAINER_NAME)
  await waitForJobToComplete(job.metadata.name)
  // pod has failed so pull the status code from the container
  const status = await getPodStatus(podName)
  if (!status?.containerStatuses?.length) {
    core.warning(`Can't determine container status`)
    return 0
  }
  const exitCode =
    status.containerStatuses[status.containerStatuses.length - 1].state
      ?.terminated?.exitCode
  return Number(exitCode) || 0
}

function createPodSpec(container, secretName?: string): k8s.V1Container {
  const podContainer = new k8s.V1Container()
  podContainer.name = JOB_CONTAINER_NAME
  podContainer.image = container.image
  if (container.entryPoint) {
    podContainer.command = [container.entryPoint, ...container.entryPointArgs]
  }
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
  podContainer.volumeMounts = containerVolumes()

  return podContainer
}
