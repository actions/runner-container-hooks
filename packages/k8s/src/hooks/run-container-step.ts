import * as k8s from '@kubernetes/client-node'
import * as core from '@actions/core'
import { PodPhase } from 'hooklib'
import {
  createJob,
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
  const container = createPodSpec(stepContainer)
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
    new Set([PodPhase.COMPLETED, PodPhase.RUNNING]),
    new Set([PodPhase.PENDING])
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

function createPodSpec(container): k8s.V1Container {
  const podContainer = new k8s.V1Container()
  podContainer.name = JOB_CONTAINER_NAME
  podContainer.image = container.image
  if (container.entryPoint) {
    podContainer.command = [container.entryPoint, ...container.entryPointArgs]
  }

  podContainer.env = []
  for (const [key, value] of Object.entries(
    container['environmentVariables']
  )) {
    if (value && key !== 'HOME') {
      podContainer.env.push({ name: key, value: value as string })
    }
  }
  podContainer.volumeMounts = containerVolumes()

  return podContainer
}
