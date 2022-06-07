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

  for (const userVolume of userMountVolumes) {
    const sourceVolumePath = `${
      path.isAbsolute(userVolume.sourceVolumePath)
        ? userVolume.sourceVolumePath
        : path.join(
            process.env.GITHUB_WORKSPACE as string,
            userVolume.sourceVolumePath
          )
    }`

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
  prependPath?: string[]
): string {
  let exportPath = ''
  if (prependPath) {
    const absolutePrependPaths = prependPath?.map(p => {
      if (path.isAbsolute(p)) {
        return p
      }
      return path.join(process.env.GITHUB_WORKSPACE as string, p)
    })
    exportPath = `export PATH=${absolutePrependPaths.join(':')}:$PATH`
  }
  const content = `#!/bin/sh -l
${exportPath}
cd ${workingDirectory}
exec ${entryPoint} ${entryPointArgs?.length ? entryPointArgs.join(' ') : ''}
`
  const filename = `${uuidv4()}.sh`
  const entryPointPath = `/runner/_work/_temp/${filename}`
  fs.writeFileSync(entryPointPath, content)
  return `/__w/_temp/${filename}`
}
