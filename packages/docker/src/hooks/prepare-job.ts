import * as core from '@actions/core'
import { ContextPorts, PrepareJobArgs, writeToResponseFile } from 'hooklib/lib'
import { exit } from 'process'
import { v4 as uuidv4 } from 'uuid'
import {
  ContainerMetadata,
  containerPorts,
  containerPrune,
  containerPull,
  containerStart,
  createContainer,
  healthCheck,
  isContainerAlpine,
  registryLogin,
  registryLogout
} from '../dockerCommands/container'
import { networkCreate, networkPrune } from '../dockerCommands/network'
import { sanitize } from '../utils'

export async function prepareJob(
  args: PrepareJobArgs,
  responseFile
): Promise<void> {
  await containerPrune()
  await networkPrune()

  const container = args.container
  const services = args.services

  if (!container?.image && !services?.length) {
    core.info('No containers exist, skipping hook invocation')
    exit(0)
  }

  let networkName = process.env.ACTIONS_RUNNER_NETWORK_DRIVER
  if (!networkName) {
    networkName = generateNetworkName()
    // Create network
    await networkCreate(networkName)
  }

  // Create Job Container
  let containerMetadata: ContainerMetadata | undefined = undefined
  if (!container?.image) {
    core.info('No job container provided, skipping')
  } else {
    setupContainer(container, true)

    const configLocation = await registryLogin(container.registry)
    try {
      await containerPull(container.image, configLocation)
    } finally {
      await registryLogout(configLocation)
    }

    containerMetadata = await createContainer(
      container,
      generateContainerName(container.image),
      networkName
    )
    if (!containerMetadata?.id) {
      throw new Error('Failed to create container')
    }
    await containerStart(containerMetadata?.id)
  }

  // Create Service Containers
  const servicesMetadata: ContainerMetadata[] = []
  if (!services?.length) {
    core.info('No service containers provided, skipping')
  } else {
    for (const service of services) {
      const configLocation = await registryLogin(service.registry)
      try {
        await containerPull(service.image, configLocation)
      } finally {
        await registryLogout(configLocation)
      }

      setupContainer(service)
      const response = await createContainer(
        service,
        generateContainerName(service.image),
        networkName
      )

      servicesMetadata.push(response)
      await containerStart(response.id)
    }
  }

  if (
    (container && !containerMetadata?.id) ||
    (services?.length && servicesMetadata.some(s => !s.id))
  ) {
    throw new Error(
      `Not all containers are started correctly ${
        containerMetadata?.id
      }, ${servicesMetadata.map(e => e.id).join(',')}`
    )
  }

  let isAlpine = false
  if (containerMetadata?.id) {
    isAlpine = await isContainerAlpine(containerMetadata.id)
  }

  if (containerMetadata?.id) {
    containerMetadata.ports = await containerPorts(containerMetadata.id)
  }
  if (servicesMetadata?.length) {
    for (const serviceMetadata of servicesMetadata) {
      serviceMetadata.ports = await containerPorts(serviceMetadata.id)
    }
  }

  const healthChecks: Promise<void>[] = []
  if (containerMetadata) {
    healthChecks.push(healthCheck(containerMetadata))
  }
  for (const service of servicesMetadata) {
    healthChecks.push(healthCheck(service))
  }
  try {
    await Promise.all(healthChecks)
    core.info('All services are healthy')
  } catch (error) {
    core.error(`Failed to initialize containers, ${error}`)
    throw new Error(`Failed to initialize containers, ${error}`)
  }

  generateResponseFile(
    responseFile,
    networkName,
    containerMetadata,
    servicesMetadata,
    isAlpine
  )
}

function generateResponseFile(
  responseFile: string,
  networkName: string,
  containerMetadata?: ContainerMetadata,
  servicesMetadata?: ContainerMetadata[],
  isAlpine = false
): void {
  const response = {
    state: { network: networkName },
    context: {},
    isAlpine
  }
  if (containerMetadata) {
    response.state['container'] = containerMetadata.id
    const contextMeta = JSON.parse(JSON.stringify(containerMetadata))
    if (containerMetadata.ports) {
      contextMeta.ports = transformDockerPortsToContextPorts(containerMetadata)
    }
    response.context['container'] = contextMeta

    if (containerMetadata.ports) {
      response.context['container'].ports =
        transformDockerPortsToContextPorts(containerMetadata)
    }
  }
  if (servicesMetadata && servicesMetadata.length > 0) {
    response.state['services'] = []
    response.context['services'] = []
    for (const meta of servicesMetadata) {
      response.state['services'].push(meta.id)
      const contextMeta = JSON.parse(JSON.stringify(meta))
      if (contextMeta.ports) {
        contextMeta.ports = transformDockerPortsToContextPorts(contextMeta)
      }
      response.context['services'].push(contextMeta)
    }
  }
  writeToResponseFile(responseFile, JSON.stringify(response))
}

function setupContainer(container, jobContainer = false): void {
  if (!container.entryPoint && jobContainer) {
    container.entryPointArgs = [`-f`, `/dev/null`]
    container.entryPoint = 'tail'
  }
}

function generateNetworkName(): string {
  return `github_network_${uuidv4()}`
}

function generateContainerName(container): string {
  const randomAlias = uuidv4().replace(/-/g, '')
  const randomSuffix = uuidv4().substring(0, 6)
  return `${randomAlias}_${sanitize(container.image)}_${randomSuffix}`
}

function transformDockerPortsToContextPorts(
  meta: ContainerMetadata
): ContextPorts {
  // ex: '80/tcp -> 0.0.0.0:80'
  const re = /^(\d+)(\/\w+)? -> (.*):(\d+)$/
  const contextPorts: ContextPorts = {}

  if (meta.ports?.length) {
    for (const port of meta.ports) {
      const matches = port.match(re)
      if (!matches) {
        throw new Error(
          'Container ports could not match the regex: "^(\\d+)(\\/\\w+)? -> (.*):(\\d+)$"'
        )
      }
      contextPorts[matches[1]] = matches[matches.length - 1]
    }
  }

  return contextPorts
}
