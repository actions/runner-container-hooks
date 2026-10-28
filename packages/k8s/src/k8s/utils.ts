import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as core from '@actions/core'
import { v1 as uuidv4 } from 'uuid'
import {
  CONTAINER_EXTENSION_PREFIX,
  EXTERNALS_VOLUME_SUBPATH
} from '../hooks/constants'
import * as shlex from 'shlex'
import { Mount } from 'hooklib'
import * as path from 'path'
import { POD_VOLUME_NAME } from './index'

export const DEFAULT_CONTAINER_ENTRY_POINT_ARGS = [`-f`, `/dev/null`]
export const DEFAULT_CONTAINER_ENTRY_POINT = 'tail'

export const ENV_HOOK_TEMPLATE_PATH = 'ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE'
export const ENV_HOOK_RWO = 'ACTIONS_RUNNER_HOOK_RWO'

// Path of the runner's work directory, which is what the shared volume is
// mounted from. RUNNER_WORKSPACE is `<work>/<repo>`, so its parent is the
// work root. Searching GITHUB_WORKSPACE for the last `_work/` instead is
// wrong for repositories whose name contains `_work`: with
// GITHUB_WORKSPACE=/home/runner/_work/my_work/my_work the last occurrence
// is inside the repository name and the lookup yields `my_work` rather
// than `my_work/my_work`, mounting the checkout's parent.
function workRoot(): string {
  const runnerWorkspace = process.env.RUNNER_WORKSPACE
  if (!runnerWorkspace) {
    throw new Error('RUNNER_WORKSPACE is not set')
  }
  return path.dirname(runnerWorkspace)
}

// GITHUB_WORKSPACE expressed relative to the work root, which is the subPath
// of the checkout inside the shared volume.
export function workspaceRelativePath(workspacePath: string): string {
  return path.posix.relative(workRoot(), workspacePath)
}

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
    mounts.push(
      {
        name: POD_VOLUME_NAME,
        mountPath: '/github/workspace',
        subPath: workspaceRelativePath(workspacePath)
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
      subPath: EXTERNALS_VOLUME_SUBPATH
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
      // Resolve the path relative to the workspace to decide containment.
      // A plain startsWith() is not path containment: it accepts sibling
      // directories that merely share a prefix (repo-evil vs repo) and then
      // silently mounts the wrong directory.
      const sourceRelativePath = path.posix.relative(
        workspacePath,
        userVolume.sourceVolumePath
      )
      if (
        sourceRelativePath === '..' ||
        sourceRelativePath.startsWith('../') ||
        path.posix.isAbsolute(sourceRelativePath)
      ) {
        throw new Error(
          'Volume mounts outside of the work folder are not supported'
        )
      }
      const relativeWorkspace = workspaceRelativePath(workspacePath)
      sourceVolumePath = sourceRelativePath
        ? path.posix.join(relativeWorkspace, sourceRelativePath)
        : relativeWorkspace
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

export function writeEntryPointScript(
  workingDirectory: string,
  entryPoint: string,
  entryPointArgs?: string[],
  prependPath?: string[],
  environmentVariables?: { [key: string]: string }
): { containerPath: string; runnerPath: string } {
  let exportPath = ''
  if (prependPath?.length) {
    const prepend =
      typeof prependPath === 'string' ? prependPath : prependPath.join(':')
    exportPath = `export PATH=${prepend}:$PATH`
  }

  const environmentPrefix = scriptEnv(environmentVariables)

  const content = `#!/bin/sh -l
${exportPath}
cd ${workingDirectory} && \\
exec ${environmentPrefix} ${entryPoint} ${
    entryPointArgs?.length ? entryPointArgs.join(' ') : ''
  }
`
  const filename = `${uuidv4()}.sh`
  const entryPointPath = `${process.env.RUNNER_TEMP}/${filename}`
  fs.writeFileSync(entryPointPath, content)
  return {
    containerPath: `/__w/_temp/${filename}`,
    runnerPath: entryPointPath
  }
}

export function writeContainerStepScript(
  dst: string,
  workingDirectory: string,
  entryPoint: string,
  entryPointArgs?: string[],
  environmentVariables?: { [key: string]: string }
): { containerPath: string; runnerPath: string } {
  let environmentPrefix = scriptEnv(environmentVariables)

  const parts = workingDirectory.split('/').slice(-2)
  if (parts.length !== 2) {
    throw new Error(`Invalid working directory: ${workingDirectory}`)
  }

  const content = `#!/bin/sh -l
rm "$0" # remove script after running
mv /__w/_temp/_github_home /github/home && \
mv /__w/_temp/_github_workflow /github/workflow && \
mv /__w/_temp/_runner_file_commands /github/file_commands || true && \
mv /__w/${parts.join('/')}/ /github/workspace && \
cd /github/workspace && \
exec ${environmentPrefix} ${entryPoint} ${
    entryPointArgs?.length ? entryPointArgs.join(' ') : ''
  }
`
  const filename = `${uuidv4()}.sh`
  const entryPointPath = `${dst}/${filename}`
  core.debug(`Writing container step script to ${entryPointPath}`)
  fs.writeFileSync(entryPointPath, content)
  return {
    containerPath: `/__w/_temp/${filename}`,
    runnerPath: entryPointPath
  }
}

function scriptEnv(envs?: { [key: string]: string }): string {
  if (!envs || !Object.entries(envs).length) {
    return ''
  }
  const envBuffer: string[] = []
  for (const [key, value] of Object.entries(envs)) {
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

  if (!envBuffer?.length) {
    return ''
  }

  return `env ${envBuffer.join(' ')} `
}

export function generateContainerName(image: string): string {
  const nameWithTag = image.split('/').pop()
  const name = nameWithTag?.split(':')[0]

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

export function useRwoRequiredAffinity(): boolean {
  return process.env[ENV_HOOK_RWO] === 'true'
}

// `nodeName` is a Node's `metadata.name`. Matching it against the
// `kubernetes.io/hostname` label is an indirection that is not guaranteed to
// hold: kubelet seeds that label from the machine's hostname while the node
// name can come from `--hostname-override` or a cloud provider, and the label
// is mutable afterwards. Where the two differ the required affinity never
// matches and the pod stays Pending forever, so select on the field instead.
export function nodeNameRequirement(
  nodeName: string
): k8s.V1NodeSelectorRequirement {
  return {
    key: 'metadata.name',
    operator: 'In',
    values: [nodeName]
  }
}

// The pod template extension is merged last and replaces whole pod spec
// fields, so a template that sets `affinity` would silently drop the node
// affinity that pins job pods to the runner's node. That is only a
// preference in RWX mode, but with a ReadWriteOnce volume it is the
// guarantee that keeps the pod schedulable at all, so re-assert it after
// the merge instead of letting the extension win.
export function ensureRequiredNodeAffinity(
  spec: k8s.V1PodSpec,
  nodeName: string
): void {
  const requirement = nodeNameRequirement(nodeName)

  spec.affinity = spec.affinity ?? {}
  spec.affinity.nodeAffinity = spec.affinity.nodeAffinity ?? {}
  const nodeAffinity = spec.affinity.nodeAffinity

  const terms =
    nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution
      ?.nodeSelectorTerms
  if (!terms?.length) {
    nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution = {
      nodeSelectorTerms: [{ matchFields: [requirement] }]
    }
    return
  }

  // nodeSelectorTerms are OR'ed while matchFields/matchExpressions inside a
  // term are AND'ed, so the node requirement has to be added to every term
  // for the constraint to hold no matter which term the scheduler matches.
  for (const term of terms) {
    term.matchFields = [
      ...(term.matchFields ?? []).filter(e => e.key !== requirement.key),
      requirement
    ]

    // An extension pinning the node by hostname label would be AND'ed with
    // the requirement above and could make the pod unschedulable, so the
    // runner's node wins in RWO mode.
    const expressions = (term.matchExpressions ?? []).filter(
      e => e.key !== 'kubernetes.io/hostname'
    )
    if (expressions.length) {
      term.matchExpressions = expressions
    } else {
      delete term.matchExpressions
    }
  }
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
  // Preserve shell command strings passed via `sh -c` without re-tokenizing.
  // Retokenizing would split the script into multiple args, breaking `sh -c`.
  // Everything after the script is $0 and the positional parameters, so it
  // must stay in its own argv slot rather than being folded into the script.
  if (args.length >= 2 && args[0] === 'sh' && args[1] === '-c') {
    return args
  }
  return shlex.split(args.join(' '))
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Safely turn an unknown thrown value into a diagnostic string without
// throwing. The previous `JSON.stringify(err)` pattern crashed with
// `TypeError: Converting circular structure to JSON` when err was a
// @kubernetes/client-node HTTP error (its response embeds a
// TLSSocket <-> HTTPParser cycle). The thrown TypeError shadowed the
// original failure in every catch block that used it (issue #329).
export function formatError(err: unknown): string {
  if (err === null || err === undefined) {
    return String(err)
  }

  // @kubernetes/client-node API errors expose the actual server message
  // under response.body — prefer that when available.
  const body =
    (err as { response?: { body?: unknown } })?.response?.body ??
    (err as { body?: unknown })?.body
  if (body && typeof body === 'object') {
    const msg = (body as { message?: unknown }).message
    const reason = (body as { reason?: unknown }).reason
    if (typeof msg === 'string') {
      return typeof reason === 'string' && reason.length > 0
        ? `${msg} (reason: ${reason})`
        : msg
    }
  }

  if (err instanceof Error) {
    return err.message
  }

  if (typeof err === 'object') {
    // Non-Error objects sometimes carry a top-level message (axios-style
    // errors, hand-rolled error-likes). Extract before the JSON.stringify
    // branch so a circular ref doesn't reduce the diagnostic to
    // "[object Object]".
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string') {
      return msg
    }
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }

  // Primitives serialise more readably via String() than JSON.stringify
  // (which would quote strings and refuse to handle symbols).
  return String(err)
}
