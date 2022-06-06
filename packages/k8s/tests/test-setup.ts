import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import * as k8s from '@kubernetes/client-node'
import { V1PersistentVolumeClaim } from '@kubernetes/client-node'

const kc = new k8s.KubeConfig()

kc.loadFromDefault()

const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

export class TestHelper {
  private tempDirPath: string
  private podName: string
  constructor() {
    this.tempDirPath = `${__dirname}/_temp/runner`
    this.podName = uuidv4().replace('-', '')
  }

  public async initialize(): Promise<void> {
    await this.cleanupK8sResources()
    await this.createTestVolume()
    await this.createTestJobPod()
    fs.mkdirSync(`${this.tempDirPath}/work/repo/repo`, { recursive: true })
    fs.mkdirSync(`${this.tempDirPath}/externals`, { recursive: true })
    process.env['ACTIONS_RUNNER_POD_NAME'] = `${this.podName}`
    process.env['ACTIONS_RUNNER_CLAIM_NAME'] = `${this.podName}-work`
    process.env['RUNNER_WORKSPACE'] = `${this.tempDirPath}/work/repo`
    process.env['GITHUB_WORKSPACE'] = `${this.tempDirPath}/work/repo/repo`
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'default'
  }

  public async cleanup(): Promise<void> {
    try {
      await this.cleanupK8sResources()
      fs.rmSync(this.tempDirPath, { recursive: true })
    } catch {}
  }
  public async cleanupK8sResources() {
    await k8sApi
      .deleteNamespacedPersistentVolumeClaim(
        `${this.podName}-work`,
        'default',
        undefined,
        undefined,
        0
      )
      .catch(e => {})
    await k8sApi
      .deleteNamespacedPod(this.podName, 'default', undefined, undefined, 0)
      .catch(e => {})
    await k8sApi
      .deleteNamespacedPod(
        `${this.podName}-workflow`,
        'default',
        undefined,
        undefined,
        0
      )
      .catch(e => {})
  }
  public createFile(fileName?: string): string {
    const filePath = `${this.tempDirPath}/${fileName || uuidv4()}`
    fs.writeFileSync(filePath, '')
    return filePath
  }

  public removeFile(fileName: string): void {
    const filePath = `${this.tempDirPath}/${fileName}`
    fs.rmSync(filePath)
  }

  public async createTestJobPod() {
    const container = {
      name: 'nginx',
      image: 'nginx:latest',
      imagePullPolicy: 'IfNotPresent'
    } as k8s.V1Container

    const pod: k8s.V1Pod = {
      metadata: {
        name: this.podName
      },
      spec: {
        restartPolicy: 'Never',
        containers: [container]
      }
    } as k8s.V1Pod
    await k8sApi.createNamespacedPod('default', pod)
  }

  public async createTestVolume() {
    var volume: V1PersistentVolumeClaim = {
      metadata: {
        name: `${this.podName}-work`
      },
      spec: {
        accessModes: ['ReadWriteOnce'],

        volumeMode: 'Filesystem',

        resources: {
          requests: {
            storage: '1Gi'
          }
        }
      }
    }
    await k8sApi.createNamespacedPersistentVolumeClaim('default', volume)
  }
}
