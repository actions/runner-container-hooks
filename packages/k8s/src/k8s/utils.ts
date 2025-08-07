import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as core from '@actions/core'
import * as shlex from 'shlex'
import * as grpc from '@grpc/grpc-js'
import * as path from 'path'

import { Mount } from 'hooklib'
import { v1 as uuidv4 } from 'uuid'
import { POD_VOLUME_NAME } from './index'
import { CONTAINER_EXTENSION_PREFIX } from '../hooks/constants'
import { script_executor } from './script_executor'

export const DEFAULT_CONTAINER_ENTRY_POINT_ARGS = [`-f`, `/dev/null`]
export const DEFAULT_CONTAINER_ENTRY_POINT = 'tail'

export const SCRIPT_EXECUTOR_ENTRY_POINT = '/__e/node20/bin/node'
export const SCRIPT_EXECUTOR_ENTRY_POINT_ARGS = [
  '/script_executor/dist/index.js'
]

export const ENV_HOOK_TEMPLATE_PATH = 'ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE'
export const ENV_USE_KUBE_SCHEDULER = 'ACTIONS_RUNNER_USE_KUBE_SCHEDULER'
export const ENV_USE_SCRIPT_EXECUTOR = 'ACTIONS_RUNNER_USE_SCRIPT_EXECUTOR'
export const ENV_NUMBER_OF_HOSTS = 'ACTIONS_RUNNER_NUMBER_OF_HOSTS'

export function containerVolumes(
  userMountVolumes: Mount[] = [],
  jobContainer = true,
  containerAction = false
): k8s.V1VolumeMount[] {
  const mounts: k8s.V1VolumeMount[] = [
    {
      name: POD_VOLUME_NAME,
      mountPath: '/__w'
    }
  ]

  const workspacePath = process.env.GITHUB_WORKSPACE as string
  if (containerAction) {
    const i = workspacePath.lastIndexOf('_work/')
    const workspaceRelativePath = workspacePath.slice(i + '_work/'.length)
    mounts.push(
      {
        name: POD_VOLUME_NAME,
        mountPath: '/github/workspace',
        subPath: workspaceRelativePath
      },
      {
        name: POD_VOLUME_NAME,
        mountPath: '/github/file_commands',
        subPath: '_temp/_runner_file_commands'
      },
      {
        name: POD_VOLUME_NAME,
        mountPath: '/github/home',
        subPath: '_temp/_github_home'
      },
      {
        name: POD_VOLUME_NAME,
        mountPath: '/github/workflow',
        subPath: '_temp/_github_workflow'
      }
    )
    return mounts
  }

  if (!jobContainer) {
    return mounts
  }

  mounts.push(
    {
      name: POD_VOLUME_NAME,
      mountPath: '/__e',
      subPath: 'externals'
    },
    {
      name: POD_VOLUME_NAME,
      mountPath: '/github/home',
      subPath: '_temp/_github_home'
    },
    {
      name: POD_VOLUME_NAME,
      mountPath: '/github/workflow',
      subPath: '_temp/_github_workflow'
    }
  )

  if (!userMountVolumes?.length) {
    return mounts
  }

  for (const userVolume of userMountVolumes) {
    let sourceVolumePath = ''
    if (path.isAbsolute(userVolume.sourceVolumePath)) {
      if (!userVolume.sourceVolumePath.startsWith(workspacePath)) {
        throw new Error(
          'Volume mounts outside of the work folder are not supported'
        )
      }
      // source volume path should be relative path
      sourceVolumePath = userVolume.sourceVolumePath.slice(
        workspacePath.length + 1
      )
    } else {
      sourceVolumePath = userVolume.sourceVolumePath
    }

    mounts.push({
      name: POD_VOLUME_NAME,
      mountPath: userVolume.targetVolumePath,
      subPath: sourceVolumePath,
      readOnly: userVolume.readOnly
    })
  }

  return mounts
}

export function getEntryPointScriptContent(
  workingDirectory: string,
  entryPoint: string,
  entryPointArgs?: string[],
  prependPath?: string[],
  environmentVariables?: { [key: string]: string }
): string {
  let exportPath = ''
  if (prependPath?.length) {
    // TODO: remove compatibility with typeof prependPath === 'string' as we bump to next major version, the hooks will lose PrependPath compat with runners 2.293.0 and older
    const prepend =
      typeof prependPath === 'string' ? prependPath : prependPath.join(':')
    exportPath = `export PATH=${prepend}:$PATH`
  }
  let environmentPrefix = ''

  if (environmentVariables && Object.entries(environmentVariables).length) {
    const envBuffer: string[] = []
    for (const [key, value] of Object.entries(environmentVariables)) {
      if (
        key.includes(`=`) ||
        key.includes(`'`) ||
        key.includes(`"`) ||
        key.includes(`$`)
      ) {
        throw new Error(
          `environment key ${key} is invalid - the key must not contain =, $, ', or "`
        )
      }
      envBuffer.push(
        `"${key}=${value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\$/g, '\\$')
          .replace(/`/g, '\\`')}"`
      )
    }
    environmentPrefix = `env ${envBuffer.join(' ')} `
  }

  const content = `#!/bin/sh -l
${exportPath}
cd ${workingDirectory} && \
exec ${environmentPrefix} ${entryPoint} ${
    entryPointArgs?.length ? entryPointArgs.join(' ') : ''
  }
`
  return content
}

export function writeEntryPointScript(
  workingDirectory: string,
  entryPoint: string,
  entryPointArgs?: string[],
  prependPath?: string[],
  environmentVariables?: { [key: string]: string }
): { containerPath: string; runnerPath: string } {
  const content = getEntryPointScriptContent(
    workingDirectory,
    entryPoint,
    entryPointArgs,
    prependPath,
    environmentVariables
  )
  const filename = `${uuidv4()}.sh`
  const entryPointPath = `${process.env.RUNNER_TEMP}/${filename}`
  fs.writeFileSync(entryPointPath, content)
  return {
    containerPath: `/__w/_temp/${filename}`,
    runnerPath: entryPointPath
  }
}

export function generateContainerName(image: string): string {
  const nameWithTag = image.split('/').pop()
  const name = nameWithTag?.split(':').at(0)

  if (!name) {
    throw new Error(`Image definition '${image}' is invalid`)
  }

  return name
}

// Overwrite or append based on container options
//
// Keep in mind, envs and volumes could be passed as fields in container definition
// so default volume mounts and envs are appended first, and then create options are used
// to append more values
//
// Rest of the fields are just applied
// For example, container.createOptions.container.image is going to overwrite container.image field
export function mergeContainerWithOptions(
  base: k8s.V1Container,
  from: k8s.V1Container
): void {
  for (const [key, value] of Object.entries(from)) {
    if (key === 'name') {
      if (value !== CONTAINER_EXTENSION_PREFIX + base.name) {
        core.warning("Skipping name override: name can't be overwritten")
      }
      continue
    } else if (key === 'image') {
      core.warning("Skipping image override: image can't be overwritten")
      continue
    } else if (key === 'env') {
      const envs = value as k8s.V1EnvVar[]
      base.env = mergeLists(base.env, envs)
    } else if (key === 'volumeMounts' && value) {
      const volumeMounts = value as k8s.V1VolumeMount[]
      base.volumeMounts = mergeLists(base.volumeMounts, volumeMounts)
    } else if (key === 'ports' && value) {
      const ports = value as k8s.V1ContainerPort[]
      base.ports = mergeLists(base.ports, ports)
    } else {
      base[key] = value
    }
  }
}

export function mergePodSpecWithOptions(
  base: k8s.V1PodSpec,
  from: k8s.V1PodSpec
): void {
  for (const [key, value] of Object.entries(from)) {
    if (key === 'containers') {
      base.containers.push(
        ...from.containers.filter(
          e => !e.name?.startsWith(CONTAINER_EXTENSION_PREFIX)
        )
      )
    } else if (key === 'volumes' && value) {
      const volumes = value as k8s.V1Volume[]
      base.volumes = mergeLists(base.volumes, volumes)
    } else {
      base[key] = value
    }
  }
}

export function mergeObjectMeta(
  base: { metadata?: k8s.V1ObjectMeta },
  from: k8s.V1ObjectMeta
): void {
  if (!base.metadata?.labels || !base.metadata?.annotations) {
    throw new Error(
      "Can't merge metadata: base.metadata or base.annotations field is undefined"
    )
  }
  if (from?.labels) {
    for (const [key, value] of Object.entries(from.labels)) {
      if (base.metadata?.labels?.[key]) {
        core.warning(`Label ${key} is already defined and will be overwritten`)
      }
      base.metadata.labels[key] = value
    }
  }

  if (from?.annotations) {
    for (const [key, value] of Object.entries(from.annotations)) {
      if (base.metadata?.annotations?.[key]) {
        core.warning(
          `Annotation ${key} is already defined and will be overwritten`
        )
      }
      base.metadata.annotations[key] = value
    }
  }
}

export function readExtensionFromFile(): k8s.V1PodTemplateSpec | undefined {
  const filePath = process.env[ENV_HOOK_TEMPLATE_PATH]
  if (!filePath) {
    return undefined
  }
  const doc = yaml.load(fs.readFileSync(filePath, 'utf8'))
  if (!doc || typeof doc !== 'object') {
    throw new Error(`Failed to parse ${filePath}`)
  }
  return doc as k8s.V1PodTemplateSpec
}

export function useKubeScheduler(): boolean {
  return process.env[ENV_USE_KUBE_SCHEDULER] === 'true'
}

export function useScriptExecutor(): boolean {
  return process.env[ENV_USE_SCRIPT_EXECUTOR] === 'true'
}

export function getNumberOfHost(): number {
  return Number(process.env[ENV_NUMBER_OF_HOSTS]) || 1
}

export enum PodPhase {
  PENDING = 'Pending',
  RUNNING = 'Running',
  SUCCEEDED = 'Succeeded',
  FAILED = 'Failed',
  UNKNOWN = 'Unknown',
  COMPLETED = 'Completed'
}

function mergeLists<T>(base?: T[], from?: T[]): T[] {
  const b: T[] = base || []
  if (!from?.length) {
    return b
  }
  b.push(...from)
  return b
}

export function fixArgs(args: string[]): string[] {
  return shlex.split(args.join(' '))
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Invoke GRPC server at ip_address:grpc_port to run a command.
 * Stream output and error from the command to the console.
 */
export async function runScriptByGrpc(
  command: string,
  rootCert: string,
  clientCert: string,
  clientKey: string,
  ip: string,
  grpc_port = 50051
): Promise<void> {
  const client = new script_executor.ScriptExecutorClient(
    `${ip}:${grpc_port}`,
    grpc.credentials.createSsl(
      Buffer.from(rootCert),
      Buffer.from(clientKey),
      Buffer.from(clientCert),
      { rejectUnauthorized: false } // Needed for self-signed certificate.
    ),
    {
      // Ping the server every 10 seconds to ensure the connection is still active
      'grpc.keepalive_time_ms': 10_000,
      // Wait 5 seconds for the ping ack before assuming the connection is dead
      'grpc.keepalive_timeout_ms': 5_000,
      // send pings even without active streams
      'grpc.keepalive_permit_without_calls': 1
    }
  )

  // TODO(quoct): Add logic to prevent duplicate execution using the `id` field.
  const call = client.ExecuteScript(
    new script_executor.ScriptRequest({ script: command })
  )
  await new Promise<void>(async function (resolve, reject) {
    let exitCode = -1
    call.on('data', (response: script_executor.ScriptResponse) => {
      if (response.has_code) {
        exitCode = response.code
      }
      if (response.has_output) {
        process.stdout.write(response.output)
      }
      if (response.has_error) {
        process.stderr.write(response.error)
      }
    })

    call.on('end', async () => {
      // Half a second wait in case the data event with the exit code did not get triggered yet.
      await sleep(500)
      process.stdout.write(`Job exit code is ${exitCode}.`)
      if (exitCode === 0) {
        resolve()
      } else {
        reject(new Error(`Job failed with exit code ${exitCode}.`))
      }
    })

    call.on('error', (err: any) => {
      const errorMessage = `Error execing ${command}: ${err}`
      process.stdout.write(errorMessage)
      reject(new Error(errorMessage))
    })
  })
}

/**
 * Create a container that download ml-velocity-script-executor package and installs it to the
 * location mounted by scriptExecutorVolumeMount.
 */
export function createScriptExecutorContainer(
  scriptExecutorVolumeMount: k8s.V1VolumeMount,
  version = 'latest'
): k8s.V1Container {
  const initContainer = new k8s.V1Container()
  initContainer.name = 'grpc-server'
  initContainer.image =
    'node@sha256:41e4389f3d988d2ed55392df4db1420ad048ae53324a8e2b7c6d19508288107e' // node:22.16.0-alpine3.22
  initContainer.workingDir = '/app'
  initContainer.command = ['sh']
  initContainer.args = [
    '-c',
    `npm i ml-velocity-script-executor@${version}; cp -r ./node_modules/ml-velocity-script-executor/dist ${scriptExecutorVolumeMount.mountPath};`
  ]
  initContainer.volumeMounts = []

  initContainer.volumeMounts.push(scriptExecutorVolumeMount)
  return initContainer
}
