import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import { HookData } from 'hooklib/lib'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

const kc = new k8s.KubeConfig()

kc.loadFromDefault()

const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
const k8sStorageApi = kc.makeApiClient(k8s.StorageV1Api)

export class TestHelper {
  private tempDirPath: string
  public podName: string
  constructor() {
    this.tempDirPath = `${__dirname}/_temp/runner`
    this.podName = uuidv4().replace(/-/g, '')
  }

  public async initialize(): Promise<void> {
    process.env['ACTIONS_RUNNER_POD_NAME'] = `${this.podName}`
    process.env['RUNNER_WORKSPACE'] = `${this.tempDirPath}/_work/repo`
    process.env['RUNNER_TEMP'] = `${this.tempDirPath}/_work/_temp`
    process.env['GITHUB_WORKSPACE'] = `${this.tempDirPath}/_work/repo/repo`
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'default'

    fs.mkdirSync(`${this.tempDirPath}/_work/repo/repo`, { recursive: true })
    fs.mkdirSync(`${this.tempDirPath}/externals`, { recursive: true })
    fs.mkdirSync(process.env.RUNNER_TEMP, { recursive: true })

    fs.copyFileSync(
      path.resolve(`${__dirname}/../../../examples/example-script.sh`),
      `${process.env.RUNNER_TEMP}/example-script.sh`
    )

    await this.cleanupK8sResources()
    try {
      await this.createTestVolume()
      await this.createTestJobPod()
    } catch (e) {
      console.log(e)
    }
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
    await k8sApi.deletePersistentVolume(`${this.podName}-pv`).catch(e => {})
    await k8sStorageApi.deleteStorageClass('local-storage').catch(e => {})
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
    var sc: k8s.V1StorageClass = {
      metadata: {
        name: 'local-storage'
      },
      provisioner: 'kubernetes.io/no-provisioner',
      volumeBindingMode: 'Immediate'
    }
    await k8sStorageApi.createStorageClass(sc)

    var volume: k8s.V1PersistentVolume = {
      metadata: {
        name: `${this.podName}-pv`
      },
      spec: {
        storageClassName: 'local-storage',
        capacity: {
          storage: '2Gi'
        },
        volumeMode: 'Filesystem',
        accessModes: ['ReadWriteOnce'],
        hostPath: {
          path: `${this.tempDirPath}/_work`
        }
      }
    }
    await k8sApi.createPersistentVolume(volume)
    var volumeClaim: k8s.V1PersistentVolumeClaim = {
      metadata: {
        name: `${this.podName}-work`
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Filesystem',
        storageClassName: 'local-storage',
        volumeName: `${this.podName}-pv`,
        resources: {
          requests: {
            storage: '1Gi'
          }
        }
      }
    }
    await k8sApi.createNamespacedPersistentVolumeClaim('default', volumeClaim)
  }

  public getPrepareJobDefinition(): HookData {
    const prepareJob = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/prepare-job.json'),
        'utf8'
      )
    )

    prepareJob.args.container.userMountVolumes = undefined
    prepareJob.args.container.registry = null
    prepareJob.args.services.forEach(s => {
      s.registry = null
    })

    return prepareJob
  }

  public getRunScriptStepDefinition(): HookData {
    const runScriptStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-script-step.json'),
        'utf8'
      )
    )

    runScriptStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    return runScriptStep
  }

  public getRunContainerStepDefinition(): HookData {
    const runContainerStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-container-step.json'),
        'utf8'
      )
    )

    runContainerStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    runContainerStep.args.userMountVolumes = undefined
    runContainerStep.args.registry = null
    return runContainerStep
  }
}
