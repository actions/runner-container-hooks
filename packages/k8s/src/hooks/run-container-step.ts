import * as core from '@actions/core'
import * as fs from 'fs'
import * as k8s from '@kubernetes/client-node'
import { RunContainerStepArgs } from 'hooklib'
import { dirname } from 'path'
import {
  createContainerStepPod,
  deletePod,
  execCpFromPod,
  execCpToPod,
  execPodStep,
  getPrepareJobTimeoutSeconds,
  waitForPodPhases
} from '../k8s'
import {
  CONTAINER_VOLUMES,
  mergeContainerWithOptions,
  PodPhase,
  readExtensionFromFile,
  DEFAULT_CONTAINER_ENTRY_POINT_ARGS,
  writeContainerStepScript
} from '../k8s/utils'
import {
  getJobPodName,
  getStepPodName,
  JOB_CONTAINER_EXTENSION_NAME,
  JOB_CONTAINER_NAME
} from './constants'

export async function runContainerStep(
  stepContainer: RunContainerStepArgs
): Promise<number> {
  if (stepContainer.dockerfile) {
    throw new Error('Building container actions is not currently supported')
  }

  if (!stepContainer.entryPoint) {
    throw new Error(
      'failed to start the container since the entrypoint is overwritten'
    )
  }

  const envs = stepContainer.environmentVariables || {}
  envs['GITHUB_ACTIONS'] = 'true'
  if (!('CI' in envs)) {
    envs.CI = 'true'
  }

  const extension = readExtensionFromFile()

  const container = createContainerSpec(stepContainer, extension)

  let pod: k8s.V1Pod
  try {
    pod = await createContainerStepPod(getStepPodName(), container, extension)
  } catch (err) {
    core.debug(`createJob failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step: ${message}`)
  }

  if (!pod.metadata?.name) {
    throw new Error(
      `Expected job ${JSON.stringify(
        pod
      )} to have correctly set the metadata.name`
    )
  }
  const podName = pod.metadata.name

  try {
    await waitForPodPhases(
      podName,
      new Set([PodPhase.RUNNING]),
      new Set([PodPhase.PENDING, PodPhase.UNKNOWN]),
      getPrepareJobTimeoutSeconds()
    )

    const runnerWorkspace = dirname(process.env.RUNNER_WORKSPACE as string)
    const githubWorkspace = process.env.GITHUB_WORKSPACE as string
    const parts = githubWorkspace.split('/').slice(-2)
    if (parts.length !== 2) {
      throw new Error(`Invalid github workspace directory: ${githubWorkspace}`)
    }
    const relativeWorkspace = parts.join('/')

    core.debug(
      `Copying files from pod ${getJobPodName()} to ${runnerWorkspace}/${relativeWorkspace}`
    )
    await execCpFromPod(getJobPodName(), `/__w`, `${runnerWorkspace}`)

    const { containerPath, runnerPath } = writeContainerStepScript(
      `${runnerWorkspace}/__w/_temp`,
      githubWorkspace,
      stepContainer.entryPoint,
      stepContainer.entryPointArgs,
      envs
    )

    await execCpToPod(podName, `${runnerWorkspace}/__w`, '/__w')

    fs.rmSync(`${runnerWorkspace}/__w`, { recursive: true, force: true })

    try {
      core.debug(`Executing container step script in pod ${podName}`)
      return await execPodStep(
        ['/__e/sh', '-e', containerPath],
        pod.metadata.name,
        JOB_CONTAINER_NAME
      )
    } catch (err) {
      core.debug(`execPodStep failed: ${JSON.stringify(err)}`)
      const message = (err as any)?.response?.body?.message || err
      throw new Error(`failed to run script step: ${message}`)
    } finally {
      fs.rmSync(runnerPath, { force: true })
    }
  } catch (error) {
    core.error(`Failed to run container step: ${error}`)
    throw error
  } finally {
    await deletePod(podName).catch(err => {
      core.error(`Failed to delete step pod ${podName}: ${err}`)
    })
  }
}

function createContainerSpec(
  container: RunContainerStepArgs,
  extension?: k8s.V1PodTemplateSpec
): k8s.V1Container {
  const podContainer = new k8s.V1Container()
  podContainer.name = JOB_CONTAINER_NAME
  podContainer.image = container.image
  podContainer.workingDir = '/__w'
  podContainer.command = ['/__e/tail']
  podContainer.args = DEFAULT_CONTAINER_ENTRY_POINT_ARGS

  podContainer.volumeMounts = CONTAINER_VOLUMES

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
