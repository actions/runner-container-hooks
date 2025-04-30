import * as core from '@actions/core'
import * as fs from 'fs'
import {
  ContainerInfo,
  Registry,
  RunContainerStepArgs,
  ServiceContainerInfo
} from 'hooklib/lib'
import * as path from 'path'
import { env } from 'process'
import { v4 as uuidv4 } from 'uuid'
import { runDockerCommand, RunDockerCommandOptions } from '../utils'
import { getRunnerLabel } from './constants'

export async function createContainer(
  args: ContainerInfo,
  name: string,
  network: string
): Promise<ContainerMetadata> {
  if (!args.image) {
    throw new Error('Image was expected')
  }

  const dockerArgs: string[] = ['create']
  dockerArgs.push(`--label=${getRunnerLabel()}`)
  dockerArgs.push(`--network=${network}`)
  if ((args as ServiceContainerInfo)?.contextName) {
    dockerArgs.push(
      `--network-alias=${(args as ServiceContainerInfo)?.contextName}`
    )
  }

  dockerArgs.push('--name', name)

  if (args?.portMappings?.length) {
    for (const portMapping of args.portMappings) {
      dockerArgs.push('-p', portMapping)
    }
  }
  if (args.createOptions) {
    dockerArgs.push(...args.createOptions.split(' '))
  }

  if (args.environmentVariables) {
    for (const [key] of Object.entries(args.environmentVariables)) {
      dockerArgs.push('-e', key)
    }
  }

  dockerArgs.push('-e', 'GITHUB_ACTIONS=true')
  // Use same behavior as the runner https://github.com/actions/runner/blob/27d9c886ab9a45e0013cb462529ac85d581f8c41/src/Runner.Worker/Container/DockerCommandManager.cs#L150
  if (!('CI' in (args.environmentVariables ?? {}))) {
    dockerArgs.push('-e', 'CI=true')
  }

  const mountVolumes = [
    ...(args.userMountVolumes || []),
    ...(args.systemMountVolumes || [])
  ]
  for (const mountVolume of mountVolumes) {
    dockerArgs.push(
      `-v=${mountVolume.sourceVolumePath}:${mountVolume.targetVolumePath}`
    )
  }
  if (args.entryPoint) {
    dockerArgs.push(`--entrypoint`)
    dockerArgs.push(args.entryPoint)
  }

  dockerArgs.push(args.image)
  if (args.entryPointArgs) {
    for (const entryPointArg of args.entryPointArgs) {
      dockerArgs.push(entryPointArg)
    }
  }

  const id = (
    await runDockerCommand(dockerArgs, { env: args.environmentVariables })
  ).trim()
  if (!id) {
    throw new Error('Could not read id from docker command')
  }
  const response: ContainerMetadata = { id, image: args.image }
  if (network) {
    response.network = network
  }
  response.ports = []

  if ((args as ServiceContainerInfo).contextName) {
    response['contextName'] = (args as ServiceContainerInfo).contextName
  }
  return response
}

export async function containerPull(
  image: string,
  configLocation: string
): Promise<void> {
  const dockerArgs: string[] = []
  if (configLocation) {
    dockerArgs.push('--config')
    dockerArgs.push(configLocation)
  }
  dockerArgs.push('pull')
  dockerArgs.push(image)
  for (let i = 0; i < 3; i++) {
    try {
      await runDockerCommand(dockerArgs)
      return
    } catch {
      core.info(`docker pull failed on attempt: ${i + 1}`)
    }
  }
  throw new Error('Exiting docker pull after 3 failed attempts')
}

export async function containerStart(id: string): Promise<void> {
  const dockerArgs: string[] = ['start']
  dockerArgs.push(`${id}`)
  await runDockerCommand(dockerArgs)
}

export async function containerStop(id: string | string[]): Promise<void> {
  const dockerArgs: string[] = ['stop']
  if (Array.isArray(id)) {
    for (const v of id) {
      dockerArgs.push(v)
    }
  } else {
    dockerArgs.push(id)
  }
  await runDockerCommand(dockerArgs)
}

export async function containerRemove(id: string | string[]): Promise<void> {
  const dockerArgs: string[] = ['rm']
  dockerArgs.push('--force')
  if (Array.isArray(id)) {
    for (const v of id) {
      dockerArgs.push(v)
    }
  } else {
    dockerArgs.push(id)
  }
  await runDockerCommand(dockerArgs)
}

export async function containerBuild(
  args: RunContainerStepArgs,
  tag: string
): Promise<void> {
  if (!args.dockerfile) {
    throw new Error("Container build expects 'args.dockerfile' to be set")
  }

  const dockerArgs: string[] = ['build']
  dockerArgs.push('-t', tag)
  dockerArgs.push('-f', args.dockerfile)
  dockerArgs.push(getBuildContext(args.dockerfile))

  await runDockerCommand(dockerArgs, {
    workingDir: getWorkingDir(args.dockerfile)
  })
}

function getBuildContext(dockerfilePath: string): string {
  return path.dirname(dockerfilePath)
}

function getWorkingDir(dockerfilePath: string): string {
  const workspace = env.GITHUB_WORKSPACE as string
  let workingDir = workspace
  if (!dockerfilePath?.includes(workspace)) {
    // This is container action
    const pathSplit = dockerfilePath.split('/')
    const actionIndex = pathSplit?.findIndex(d => d === '_actions')
    if (actionIndex) {
      const actionSubdirectoryDepth = 3 // handle + repo + [branch | tag]
      pathSplit.splice(actionIndex + actionSubdirectoryDepth + 1)
      workingDir = pathSplit.join('/')
    }
  }

  return workingDir
}

export async function containerLogs(id: string): Promise<void> {
  const dockerArgs: string[] = ['logs']
  dockerArgs.push('--details')
  dockerArgs.push(id)
  await runDockerCommand(dockerArgs)
}

export async function containerNetworkRemove(network: string): Promise<void> {
  const dockerArgs: string[] = ['network']
  dockerArgs.push('rm')
  dockerArgs.push(network)
  await runDockerCommand(dockerArgs)
}

export async function containerNetworkPrune(): Promise<void> {
  const dockerArgs = [
    'network',
    'prune',
    '--force',
    '--filter',
    `label=${getRunnerLabel()}`
  ]

  await runDockerCommand(dockerArgs)
}

export async function containerPrune(): Promise<void> {
  const dockerPSArgs: string[] = [
    'ps',
    '--all',
    '--quiet',
    '--no-trunc',
    '--filter',
    `label=${getRunnerLabel()}`
  ]

  const res = (await runDockerCommand(dockerPSArgs)).trim()
  if (res) {
    await containerRemove(res.split('\n'))
  }
}

async function containerHealthStatus(id: string): Promise<ContainerHealth> {
  const dockerArgs = [
    'inspect',
    '--format="{{if .Config.Healthcheck}}{{print .State.Health.Status}}{{end}}"',
    id
  ]
  const result = (await runDockerCommand(dockerArgs)).trim().replace(/"/g, '')
  if (
    result === ContainerHealth.Healthy ||
    result === ContainerHealth.Starting ||
    result === ContainerHealth.Unhealthy
  ) {
    return result
  }

  return ContainerHealth.None
}

export async function healthCheck({
  id,
  image
}: ContainerMetadata): Promise<void> {
  let health = await containerHealthStatus(id)
  if (health === ContainerHealth.None) {
    core.info(
      `Healthcheck is not set for container ${image}, considered as ${ContainerHealth.Healthy}`
    )
    return
  }

  let tries = 1
  while (health === ContainerHealth.Starting && tries < 13) {
    const backOffSeconds = Math.pow(2, tries)
    core.info(
      `Container '${image}' is '${health}', retry in ${backOffSeconds} seconds`
    )
    await new Promise(resolve => setTimeout(resolve, 1000 * backOffSeconds))
    tries++
    health = await containerHealthStatus(id)
  }

  if (health !== ContainerHealth.Healthy) {
    throw new String(
      `Container '${image}' is unhealthy with status '${health}'`
    )
  }
}

export async function containerPorts(id: string): Promise<string[]> {
  const dockerArgs = ['port', id]
  const portMappings = (await runDockerCommand(dockerArgs)).trim()
  return portMappings.split('\n').filter(p => !!p)
}

export async function getContainerEnvValue(
  id: string,
  name: string
): Promise<string> {
  const dockerArgs = [
    'inspect',
    `--format='{{range $index, $value := .Config.Env}}{{if eq (index (split $value "=") 0) "${name}"}}{{index (split $value "=") 1}}{{end}}{{end}}'`,
    id
  ]
  const value = (await runDockerCommand(dockerArgs)).trim()
  const lines = value.split('\n')
  return lines.length ? lines[0].replace(/^'/, '').replace(/'$/, '') : ''
}

export async function registryLogin(registry?: Registry): Promise<string> {
  if (!registry) {
    return ''
  }
  const credentials = {
    username: registry.username,
    password: registry.password
  }

  const configLocation = `${env.RUNNER_TEMP}/.docker_${uuidv4()}`
  fs.mkdirSync(configLocation)
  try {
    await dockerLogin(configLocation, registry.serverUrl, credentials)
  } catch (error) {
    fs.rmdirSync(configLocation, { recursive: true })
    throw error
  }
  return configLocation
}

export async function registryLogout(configLocation: string): Promise<void> {
  if (configLocation) {
    await dockerLogout(configLocation)
    fs.rmdirSync(configLocation, { recursive: true })
  }
}

async function dockerLogin(
  configLocation: string,
  registry: string,
  credentials: { username?: string; password?: string }
): Promise<void> {
  const credentialsArgs =
    credentials.username && credentials.password
      ? ['-u', credentials.username, '--password-stdin']
      : []

  const dockerArgs = [
    '--config',
    configLocation,
    'login',
    ...credentialsArgs,
    registry
  ]

  const options: RunDockerCommandOptions =
    credentials.username && credentials.password
      ? {
          input: Buffer.from(credentials.password, 'utf-8')
        }
      : {}

  await runDockerCommand(dockerArgs, options)
}

async function dockerLogout(configLocation: string): Promise<void> {
  const dockerArgs = ['--config', configLocation, 'logout']
  await runDockerCommand(dockerArgs)
}

export async function containerExecStep(
  args,
  containerId: string
): Promise<void> {
  const dockerArgs: string[] = ['exec', '-i']
  dockerArgs.push(`--workdir=${args.workingDirectory}`)
  for (const [key] of Object.entries(args['environmentVariables'])) {
    dockerArgs.push('-e')
    dockerArgs.push(key)
  }

  if (args.prependPath?.length) {
    // TODO: remove compatibility with typeof prependPath === 'string' as we bump to next major version, the hooks will lose PrependPath compat with runners 2.293.0 and older
    const prependPath =
      typeof args.prependPath === 'string'
        ? args.prependPath
        : args.prependPath.join(':')

    dockerArgs.push(
      '-e',
      `PATH=${prependPath}:${await getContainerEnvValue(containerId, 'PATH')}`
    )
  }

  dockerArgs.push(containerId)
  dockerArgs.push(args.entryPoint)
  for (const entryPointArg of args.entryPointArgs) {
    dockerArgs.push(entryPointArg)
  }
  await runDockerCommand(dockerArgs, { env: args.environmentVariables })
}

export async function containerRun(
  args: RunContainerStepArgs,
  name: string,
  network?: string
): Promise<void> {
  if (!args.image) {
    throw new Error('expected image to be set')
  }
  const dockerArgs: string[] = ['run', '--rm']

  dockerArgs.push('--name', name)
  dockerArgs.push(`--workdir=${args.workingDirectory}`)
  dockerArgs.push(`--label=${getRunnerLabel()}`)
  if (network) {
    dockerArgs.push(`--network=${network}`)
  }

  if (args.createOptions) {
    dockerArgs.push(...args.createOptions.split(' '))
  }
  if (args.environmentVariables) {
    for (const [key] of Object.entries(args.environmentVariables)) {
      dockerArgs.push('-e', key)
    }
  }

  dockerArgs.push('-e', 'GITHUB_ACTIONS=true')
  // Use same behavior as the runner https://github.com/actions/runner/blob/27d9c886ab9a45e0013cb462529ac85d581f8c41/src/Runner.Worker/Container/DockerCommandManager.cs#L150
  if (!('CI' in (args.environmentVariables ?? {}))) {
    dockerArgs.push('-e', 'CI=true')
  }

  const mountVolumes = [
    ...(args.userMountVolumes || []),
    ...(args.systemMountVolumes || [])
  ]
  for (const mountVolume of mountVolumes) {
    dockerArgs.push(`-v`)
    dockerArgs.push(
      `${mountVolume.sourceVolumePath}:${mountVolume.targetVolumePath}${
        mountVolume.readOnly ? ':ro' : ''
      }`
    )
  }

  if (args['entryPoint']) {
    dockerArgs.push(`--entrypoint`)
    dockerArgs.push(args['entryPoint'])
  }
  dockerArgs.push(args.image)
  if (args.entryPointArgs) {
    for (const entryPointArg of args.entryPointArgs) {
      if (!entryPointArg) {
        continue
      }
      dockerArgs.push(entryPointArg)
    }
  }

  await runDockerCommand(dockerArgs, { env: args.environmentVariables })
}

export async function isContainerAlpine(containerId: string): Promise<boolean> {
  const dockerArgs: string[] = [
    'exec',
    containerId,
    'sh',
    '-c',
    `'[ $(cat /etc/*release* | grep -i -e "^ID=*alpine*" -c) != 0 ] || exit 1'`
  ]
  try {
    await runDockerCommand(dockerArgs)
    return true
  } catch {
    return false
  }
}

enum ContainerHealth {
  Starting = 'starting',
  Healthy = 'healthy',
  Unhealthy = 'unhealthy',
  None = 'none'
}

export interface ContainerMetadata {
  id: string
  image: string
  network?: string
  ports?: string[]
  contextName?: string
}
