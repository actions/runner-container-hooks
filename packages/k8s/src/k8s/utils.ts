import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import { Mount } from 'hooklib'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { POD_VOLUME_NAME } from './index'

export const DEFAULT_CONTAINER_ENTRY_POINT_ARGS = [`-f`, `/dev/null`]
export const DEFAULT_CONTAINER_ENTRY_POINT = 'tail'

export function containerVolumes(
  userMountVolumes: Mount[] = [],
  jobContainer = true
): k8s.V1VolumeMount[] {
  const mounts: k8s.V1VolumeMount[] = [
    {
      name: POD_VOLUME_NAME,
      mountPath: '/__w'
    }
  ]

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

  const workspacePath = process.env.GITHUB_WORKSPACE as string
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

export function writeEntryPointScript(
  workingDirectory: string,
  entryPoint: string,
  entryPointArgs?: string[],
  prependPath?: string[],
  environmentVariables?: { [key: string]: string }
): { containerPath: string; runnerPath: string } {
  let exportPath = ''
  if (prependPath?.length) {
    exportPath = `export PATH=${prependPath.join(':')}:$PATH`
  }
  let environmentPrefix = ''

  if (environmentVariables && Object.entries(environmentVariables).length) {
    const envBuffer: string[] = []
    for (const [key, value] of Object.entries(environmentVariables)) {
      envBuffer.push(
        `"${key}=${value.replace(`\\`, `\\\\`).replace(`"`, `\\"`)}"`
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
  const filename = `${uuidv4()}.sh`
  const entryPointPath = `${process.env.RUNNER_TEMP}/${filename}`
  fs.writeFileSync(entryPointPath, content)
  return {
    containerPath: `/__w/_temp/${filename}`,
    runnerPath: entryPointPath
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
