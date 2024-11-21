import * as core from '@actions/core'
import * as io from '@actions/io'
import * as k8s from '@kubernetes/client-node'
import {
  JobContainerInfo,
  ContextPorts,
  PrepareJobArgs,
  writeToResponseFile
} from 'hooklib'
import path from 'path'
import {
  containerPorts,
  createPod,
  isPodContainerAlpine,
  prunePods,
  waitForPodPhases,
  getPrepareJobTimeoutSeconds
} from '../k8s'
import {
  containerVolumes,
  DEFAULT_CONTAINER_ENTRY_POINT,
  DEFAULT_CONTAINER_ENTRY_POINT_ARGS,
  generateContainerName,
  mergeContainerWithOptions,
  readExtensionFromFile,
  PodPhase,
  fixArgs
} from '../k8s/utils'
import { CONTAINER_EXTENSION_PREFIX, JOB_CONTAINER_NAME } from './constants'

export async function prepareJob(
  args: PrepareJobArgs,
  responseFile
): Promise<void> {
  if (!args.container) {
    throw new Error('Job Container is required.')
  }

  await prunePods()

  const extension = readExtensionFromFile()
  await copyExternalsToRoot()

  let container: k8s.V1Container | undefined = undefined
  if (args.container?.image) {
    core.debug(`Using image '${args.container.image}' for job image`)
    container = createContainerSpec(
      args.container,
      JOB_CONTAINER_NAME,
      true,
      extension
    )
  }

  let services: k8s.V1Container[] = []
  if (args.services?.length) {
    services = args.services.map(service => {
      core.debug(`Adding service '${service.image}' to pod definition`)
      return createContainerSpec(
        service,
        generateContainerName(service.image),
        false,
        extension
      )
    })
  }

  if (!container && !services?.length) {
    throw new Error('No containers exist, skipping hook invocation')
  }

  let createdPod: k8s.V1Pod | undefined = undefined
  try {
    createdPod = await createPod(
      container,
      services,
      args.container.registry,
      extension
    )
  } catch (err) {
    await prunePods()
    core.debug(`createPod failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to create job pod: ${message}`)
  }

  if (!createdPod?.metadata?.name) {
    throw new Error('created pod should have metadata.name')
  }
  core.debug(
    `Job pod created, waiting for it to come online ${createdPod?.metadata?.name}`
  )

  try {
    await waitForPodPhases(
      createdPod.metadata.name,
      new Set([PodPhase.RUNNING]),
      new Set([PodPhase.PENDING]),
      getPrepareJobTimeoutSeconds()
    )
  } catch (err) {
    await prunePods()
    throw new Error(`pod failed to come online with error: ${err}`)
  }

  core.debug('Job pod is ready for traffic')

  let isAlpine = false
  try {
    isAlpine = await isPodContainerAlpine(
      createdPod.metadata.name,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    core.debug(
      `Failed to determine if the pod is alpine: ${JSON.stringify(err)}`
    )
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to determine if the pod is alpine: ${message}`)
  }
  core.debug(`Setting isAlpine to ${isAlpine}`)
  generateResponseFile(responseFile, args, createdPod, isAlpine)
}

function generateResponseFile(
  responseFile: string,
  args: PrepareJobArgs,
  appPod: k8s.V1Pod,
  isAlpine
): void {
  if (!appPod.metadata?.name) {
    throw new Error('app pod must have metadata.name specified')
  }
  const response = {
    state: {
      jobPod: appPod.metadata.name
    },
    context: {},
    isAlpine
  }

  const mainContainer = appPod.spec?.containers?.find(
    c => c.name === JOB_CONTAINER_NAME
  )
  if (mainContainer) {
    const mainContainerContextPorts: ContextPorts = {}
    if (mainContainer?.ports) {
      for (const port of mainContainer.ports) {
        mainContainerContextPorts[port.containerPort] =
          mainContainerContextPorts.hostPort
      }
    }

    response.context['container'] = {
      image: mainContainer.image,
      ports: mainContainerContextPorts
    }
  }

  if (args.services?.length) {
    const serviceContainerNames =
      args.services?.map(s => generateContainerName(s.image)) || []

    response.context['services'] = appPod?.spec?.containers
      ?.filter(c => serviceContainerNames.includes(c.name))
      .map(c => {
        const ctxPorts: ContextPorts = {}
        if (c.ports?.length) {
          for (const port of c.ports) {
            ctxPorts[port.containerPort] = port.hostPort
          }
        }

        return {
          image: c.image,
          ports: ctxPorts
        }
      })
  }

  writeToResponseFile(responseFile, JSON.stringify(response))
}

async function copyExternalsToRoot(): Promise<void> {
  const workspace = process.env['RUNNER_WORKSPACE']
  if (workspace) {
    await io.cp(
      path.join(workspace, '../../externals'),
      path.join(workspace, '../externals'),
      { force: true, recursive: true, copySourceDirectory: false }
    )
  }
}

export function createContainerSpec(
  container: JobContainerInfo,
  name: string,
  jobContainer = false,
  extension?: k8s.V1PodTemplateSpec
): k8s.V1Container {
  if (!container.entryPoint && jobContainer) {
    container.entryPoint = DEFAULT_CONTAINER_ENTRY_POINT
    container.entryPointArgs = DEFAULT_CONTAINER_ENTRY_POINT_ARGS
  }

  const resources = new k8s.V1ResourceRequirements()
  const limit_cpu = process.env.ACTIONS_POD_RESOURCE_LIMIT_CPU
  const limit_memory = process.env.ACTIONS_POD_RESOURCE_LIMIT_MEMORY
  const request_memory = process.env.ACTIONS_POD_RESOURCE_REQUEST_MEMORY
  const request_cpu = process.env.ACTIONS_POD_RESOURCE_REQUEST_CPU
  const imagePullPolicy = process.env.ACTIONS_POD_IMAGE_PULL_POLICY
  const tailscaleAuthSecret = process.env.ACTIONS_POD_TAILSCALE_SECRET
  resources.requests = {
    ...(request_cpu != undefined) && {cpu: request_cpu},
    ...(request_memory != undefined) && {memory: request_memory},
  }
  resources.limits = {
    ...(limit_cpu != undefined) && {cpu: limit_cpu},
    ...(limit_memory != undefined) && {memory: limit_memory},
  }
  const podContainer = {
    name,
    image: container.image,
    imagePullPolicy: imagePullPolicy ? imagePullPolicy : "Always",
    ports: containerPorts(container),
    resources: resources
  } as k8s.V1Container
  if (container.workingDirectory) {
    podContainer.workingDir = container.workingDirectory
  }

  if (container.entryPoint) {
    podContainer.command = [container.entryPoint]
  }

  if (container.entryPointArgs?.length > 0) {
    podContainer.args = fixArgs(container.entryPointArgs)
  }

  podContainer.env = []
  for (const [key, value] of Object.entries(
    container['environmentVariables']
  )) {
    if (value && key !== 'HOME') {
      podContainer.env.push({ name: key, value: value as string })
    }
  }
  if (tailscaleAuthSecret != undefined){
    podContainer.env.push({ name: "AUTH_KEY", value: tailscaleAuthSecret })
  }

  podContainer.volumeMounts = containerVolumes(
    container.userMountVolumes,
    jobContainer
  )

  if (!extension) {
    return podContainer
  }

  const from = extension.spec?.containers?.find(
    c => c.name === CONTAINER_EXTENSION_PREFIX + name
  )

  if (from) {
    mergeContainerWithOptions(podContainer, from)
  }

  return podContainer
}
