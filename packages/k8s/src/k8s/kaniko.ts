import * as k8s from '@kubernetes/client-node'
import * as path from 'path'
import { namespace, registryHost, registryPort } from './settings'
import {
  getRunnerPodName,
  getVolumeClaimName,
  MAX_POD_NAME_LENGTH,
  RunnerInstanceLabel
} from '../hooks/constants'
import { POD_VOLUME_NAME } from '.'

export const KANIKO_MOUNT_PATH = '/mnt/kaniko'

function getKanikoName(): string {
  return `${getRunnerPodName().substring(
    0,
    MAX_POD_NAME_LENGTH - '-kaniko'.length
  )}-kaniko`
}

export function kanikoPod(
  dockerfile: string,
  imagePath: string // <handle>/<image>:<tag>
): k8s.V1Pod {
  const pod = new k8s.V1Pod()
  pod.apiVersion = 'v1'
  pod.kind = 'Pod'
  pod.metadata = new k8s.V1ObjectMeta()
  pod.metadata.name = getKanikoName()
  const instanceLabel = new RunnerInstanceLabel()
  pod.metadata.labels = {
    [instanceLabel.key]: instanceLabel.value
  }

  const spec = new k8s.V1PodSpec()
  const c = new k8s.V1Container()
  c.image = 'gcr.io/kaniko-project/executor:latest'
  c.name = 'kaniko'
  c.imagePullPolicy = 'Always'
  const prefix = (process.env.RUNNER_WORKSPACE as string).split('_work')[0]
  const subPath = path
    .dirname(dockerfile)
    .substring(prefix.length + '_work/'.length)

  c.volumeMounts = [
    {
      name: POD_VOLUME_NAME,
      mountPath: KANIKO_MOUNT_PATH,
      subPath,
      readOnly: true
    }
  ]
  c.args = [
    `--dockerfile=${path.basename(dockerfile)}`,
    `--context=dir://${KANIKO_MOUNT_PATH}`,
    `--destination=${registryHost()}.${namespace()}.svc.cluster.local:${registryPort()}/${imagePath}`
  ]
  spec.containers = [c]
  spec.dnsPolicy = 'ClusterFirst'
  spec.restartPolicy = 'Never'
  pod.spec = spec
  const claimName: string = getVolumeClaimName()
  pod.spec.volumes = [
    {
      name: POD_VOLUME_NAME,
      persistentVolumeClaim: { claimName }
    }
  ]
  return pod
}
