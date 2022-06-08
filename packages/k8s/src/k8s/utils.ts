import * as k8s from '@kubernetes/client-node'
import { Mount } from 'hooklib'
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

  // TODO: we need to ensure this is a local path under the github workspace or fail/skip
  // subpath only accepts a local path under the runner workspace
  /*
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
  */

  return mounts
}
