import * as core from '@actions/core'
import * as io from '@actions/io'
import * as k8s from '@kubernetes/client-node'
import {
  ContextPorts,
  PodPhase,
  prepareJobArgs,
  writeToResponseFile
} from 'hooklib'
import path from 'path'
import {
  containerPorts,
  createPod,
  isAuthPermissionsOK,
  isPodContainerAlpine,
  namespace,
  podPrune,
  requiredPermissions,
  waitForPodPhases
} from '../k8s'
import {
  containerVolumes,
  DEFAULT_CONTAINER_ENTRY_POINT,
  DEFAULT_CONTAINER_ENTRY_POINT_ARGS
} from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'

export async function prepareJob(
  args: prepareJobArgs,
  responseFile
): Promise<void> {
  await podPrune()
  if (!(await isAuthPermissionsOK())) {
    throw new Error(
      `The Service account needs the following permissions ${JSON.stringify(
        requiredPermissions
      )} on the pod resource in the '${namespace}' namespace. Please contact your self hosted runner administrator.`
    )
  }
  await copyExternalsToRoot()
  let container: k8s.V1Container | undefined = undefined
  if (args.container?.image) {
    core.info(`Using image '${args.container.image}' for job image`)
    container = createPodSpec(args.container, JOB_CONTAINER_NAME, true)
  }

  let services: k8s.V1Container[] = []
  if (args.services?.length) {
    services = args.services.map(service => {
      core.info(`Adding service '${service.image}' to pod definition`)
      return createPodSpec(service, service.image.split(':')[0])
    })
  }
  if (!container && !services?.length) {
    throw new Error('No containers exist, skipping hook invocation')
  }
  let createdPod: k8s.V1Pod | undefined = undefined
  try {
    createdPod = await createPod(container, services, args.registry)
  } catch (err) {
    await podPrune()
    throw new Error(`failed to create job pod: ${err}`)
  }

  if (!createdPod?.metadata?.name) {
    throw new Error('created pod should have metadata.name')
  }

  try {
    await waitForPodPhases(
      createdPod.metadata.name,
      new Set([PodPhase.RUNNING]),
      new Set([PodPhase.PENDING])
    )
  } catch (err) {
    await podPrune()
    throw new Error(`Pod failed to come online with error: ${err}`)
  }

  core.info('Pod is ready for traffic')

  let isAlpine = false
  try {
    isAlpine = await isPodContainerAlpine(
      createdPod.metadata.name,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    throw new Error(`Failed to determine if the pod is alpine: ${err}`)
  }

  generateResponseFile(responseFile, createdPod, isAlpine)
}

function generateResponseFile(
  responseFile: string,
  appPod: k8s.V1Pod,
  isAlpine
): void {
  const response = {
    state: {},
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

  const serviceContainers = appPod.spec?.containers.filter(
    c => c.name !== JOB_CONTAINER_NAME
  )
  if (serviceContainers?.length) {
    response.context['services'] = serviceContainers.map(c => {
      if (!c.ports) {
        return
      }

      const ctxPorts: ContextPorts = {}
      for (const port of c.ports) {
        ctxPorts[port.containerPort] = port.hostPort
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

function createPodSpec(
  container,
  name: string,
  jobContainer = false
): k8s.V1Container {
  core.info(JSON.stringify(container))
  if (!container.entryPointArgs) {
    container.entryPointArgs = DEFAULT_CONTAINER_ENTRY_POINT_ARGS
  }
  container.entryPointArgs = DEFAULT_CONTAINER_ENTRY_POINT_ARGS
  if (!container.entryPoint) {
    container.entryPoint = DEFAULT_CONTAINER_ENTRY_POINT
  }
  const podContainer = {
    name,
    image: container.image,
    command: [container.entryPoint],
    args: container.entryPointArgs,
    ports: containerPorts(container)
  } as k8s.V1Container

  if (container.workingDirectory) {
    podContainer.workingDir = container.workingDirectory
  }

  if (container.createOptions) {
    podContainer.resources = getResourceRequirements(container.createOptions)
  }

  podContainer.env = []
  for (const [key, value] of Object.entries(
    container['environmentVariables']
  )) {
    if (value && key !== 'HOME') {
      podContainer.env.push({ name: key, value: value as string })
    }
  }

  podContainer.volumeMounts = containerVolumes(
    container.userMountVolumes,
    jobContainer
  )

  return podContainer
}

function getResourceRequirements(
  createOptions: string
): k8s.V1ResourceRequirements {
  const rr = new k8s.V1ResourceRequirements()
  rr.limits = {}
  rr.requests = {}

  const options = parseOptions(createOptions)
  for (const [key, value] of Object.entries(options)) {
    switch (key) {
      case '--cpus':
        rr.requests.cpu = value
        break
      case '--memory':
      case '-m':
        rr.limits.memory = value
        break
      default:
        core.warning(
          `Container option ${key} is not supported. Supported options are ['--cpus', '--memory', '-m']`
        )
    }
  }

  return rr
}

function parseOptions(options: string): { [option: string]: string } {
  const rv: { [option: string]: string } = {}

  const spaceSplit = options.split(' ')
  for (let i = 0; i < spaceSplit.length; i++) {
    if (!spaceSplit[i].startsWith('-')) {
      throw new Error(`Options specified in wrong format: ${options}`)
    }

    const optSplit = spaceSplit[i].split('=')
    const optName = optSplit[0]
    let optValue = ''
    switch (optSplit.length) {
      case 1:
        if (spaceSplit.length <= i + 1) {
          throw new Error(`Option ${optName} must have a value`)
        }
        optValue = spaceSplit[++i]
        break
      case 2:
        optValue = optSplit[1]
        break
      default:
        throw new Error(`failed to parse option ${spaceSplit[i]}`)
    }

    rv[optName] = optValue
  }

  return rv
}
